// neue-gui.js — With lil-gui controls and JSON config
import * as THREE from 'three';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

const CELLS_URL = './public/cells.bin';
const CONFIG_URL = './config.json'; // Default config file

const canvas = document.getElementById('bg-splats');
const statsEl = document.getElementById('stats');

// Default parameters
const params = {
  particleSize: 0.02,
  progress: 0.5,
  turbulenceAmount: 1.2,
  turbulenceSpeed: 0.6,
  turbulenceScale: 0.9,
  softness: 0.2, // 0 = very soft, 1 = hard edge
  edgeFade: 0.5, // Controls fade range
  visiblePercentage: 1.0, // 0-1, percentage of particles that should be visible
  fadeSpeedMin: 30, // Min frames to fade (30 = 0.5 sec at 60fps)
  fadeSpeedMax: 120, // Max frames to fade (120 = 2 sec at 60fps)
  backgroundColor: '#111111',
  blendMode: 'premultiplied',
  depthWrite: false,
  showFrame: true
};

let renderer, scene, camera, particles, uniforms, clock, gui;

init().catch(err => {
  console.error('Init error:', err);
  if (statsEl) statsEl.textContent = 'Init error (see console).';
});

async function init() {
  // Try to load config file
  await loadConfig(CONFIG_URL);

  // Renderer / Camera / Scene
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(params.backgroundColor);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 6);

  // Expose for DevTools
  Object.assign(window, { scene, camera, renderer });

  // Load pre-baked cells
  let data;
  try {
    data = await loadCellsBin(CELLS_URL);
    console.log('cells.bin loaded:', data);
    if (statsEl) statsEl.textContent = `cells: ${data.count} | grid: ${data.wCells}×${data.hCells}`;
  } catch (e) {
    console.warn('cells.bin failed to load; using fallback.', e);
    if (statsEl) statsEl.textContent = 'Using fallback particles';
    data = fallbackCells();
  }

  particles = makeInstancedParticles(data);
  scene.add(particles);

  uniforms = particles.material.uniforms;
  uniforms.uPlane.value.copy(planeSizeAtZ0());

  // Frame helper
  const frame = makeFrameHelper(uniforms.uPlane.value, data.wCells / data.hCells);
  frame.visible = params.showFrame;
  scene.add(frame);
  window.frame = frame;

  // Setup GUI
  setupGUI(frame);
  
  // Initialize particle visibility
  updateParticleTargets(particles.geometry);

  // Expose for DevTools
  window.particles = particles;

  // Animate
  clock = new THREE.Clock();
  let lastTime = 0;
  renderer.setAnimationLoop(() => {
    const currentTime = clock.getElapsedTime();
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    
    uniforms.uTime.value = currentTime;
    uniforms.uDeltaTime.value = deltaTime;
    
    // Update particle visibility
    updateParticleVisibility(particles.geometry, deltaTime);
    
    renderer.render(scene, camera);
  });

  // Resize
  window.addEventListener('resize', onResize);
  console.log('Init complete. Particles:', data.count);
}

function setupGUI(frame) {
  // Remove old HUD
  const oldHud = document.getElementById('hud');
  if (oldHud) oldHud.remove();

  gui = new GUI({ title: 'Particle Controls' });
  
  // Animation folder
  const animFolder = gui.addFolder('Animation');
  animFolder.add(params, 'progress', 0, 1, 0.001).onChange(v => {
    uniforms.uProgress.value = v;
  });
  animFolder.open();

  // Particles folder
  const particleFolder = gui.addFolder('Particles');
  particleFolder.add(params, 'particleSize', 0.001, 0.1, 0.001).onChange(v => {
    uniforms.uParticleSize.value = v;
  });
  particleFolder.add(params, 'softness', 0, 1, 0.01)
    .name('Softness (0=soft, 1=hard)')
    .onChange(v => {
      uniforms.uSoftness.value = v;
    });
  particleFolder.add(params, 'edgeFade', 0, 1, 0.01)
    .name('Fade Range')
    .onChange(v => {
      uniforms.uEdgeFade.value = v;
    });
  particleFolder.open();
  
  // Visibility folder
  const visibilityFolder = gui.addFolder('Visibility');
  visibilityFolder.add(params, 'visiblePercentage', 0, 1, 0.01)
    .name('Visible %')
    .onChange(v => {
      uniforms.uVisiblePercentage.value = v;
      updateParticleTargets(particles.geometry);
    });
  visibilityFolder.add(params, 'fadeSpeedMin', 1, 300, 1)
    .name('Fade Speed Min (frames)')
    .onChange(v => {
      updateFadeSpeeds(particles.geometry);
    });
  visibilityFolder.add(params, 'fadeSpeedMax', 1, 300, 1)
    .name('Fade Speed Max (frames)')
    .onChange(v => {
      updateFadeSpeeds(particles.geometry);
    });
  visibilityFolder.open();

  // Turbulence folder
  const turbFolder = gui.addFolder('Turbulence');
  turbFolder.add(params, 'turbulenceAmount', 0, 3, 0.01).onChange(v => {
    uniforms.uTurbulenceAmount.value = v;
  });
  turbFolder.add(params, 'turbulenceSpeed', 0, 2, 0.01).onChange(v => {
    uniforms.uTurbulenceSpeed.value = v;
  });
  turbFolder.add(params, 'turbulenceScale', 0.1, 2, 0.01).onChange(v => {
    uniforms.uTurbulenceScale.value = v;
  });
  turbFolder.open();

  // Rendering folder
  const renderFolder = gui.addFolder('Rendering');
  renderFolder.addColor(params, 'backgroundColor').onChange(v => {
    renderer.setClearColor(v);
  });
  renderFolder.add(params, 'blendMode', ['premultiplied', 'additive', 'screen', 'normal']).onChange(v => {
    switch(v) {
      case 'additive':
        particles.material.blending = THREE.AdditiveBlending;
        break;
      case 'screen':
        particles.material.blending = THREE.CustomBlending;
        particles.material.blendEquation = THREE.AddEquation;
        particles.material.blendSrc = THREE.OneFactor;
        particles.material.blendDst = THREE.OneFactor;
        break;
      case 'normal':
        particles.material.blending = THREE.NormalBlending;
        break;
      default: // premultiplied
        particles.material.blending = THREE.CustomBlending;
        particles.material.blendEquation = THREE.AddEquation;
        particles.material.blendSrc = THREE.OneFactor;
        particles.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    particles.material.needsUpdate = true;
  });
  renderFolder.add(params, 'showFrame').onChange(v => {
    frame.visible = v;
  });

  // Config folder
  const configFolder = gui.addFolder('Config');
  configFolder.add({ 
    save: () => saveConfig() 
  }, 'save').name('Save Config');
  
  configFolder.add({ 
    load: () => loadConfigDialog() 
  }, 'load').name('Load Config');
  
  configFolder.add({ 
    export: () => exportConfig() 
  }, 'export').name('Export JSON');

  // Apply initial values
  uniforms.uProgress.value = params.progress;
  uniforms.uParticleSize.value = params.particleSize;
  uniforms.uSoftness.value = params.softness;
  uniforms.uEdgeFade.value = params.edgeFade;
  uniforms.uTurbulenceAmount.value = params.turbulenceAmount;
  uniforms.uTurbulenceSpeed.value = params.turbulenceSpeed;
  uniforms.uTurbulenceScale.value = params.turbulenceScale;
}

function saveConfig() {
  const config = { ...params };
  const json = JSON.stringify(config, null, 2);
  
  // Save to localStorage
  localStorage.setItem('particleConfig', json);
  
  // Also download as file
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'particle-config.json';
  a.click();
  URL.revokeObjectURL(url);
  
  console.log('Config saved to localStorage and downloaded');
}

function exportConfig() {
  const config = { ...params };
  const json = JSON.stringify(config, null, 2);
  console.log('Current config:', json);
  alert('Config exported to console');
}

async function loadConfig(url) {
  try {
    // First try localStorage
    const stored = localStorage.getItem('particleConfig');
    if (stored) {
      const config = JSON.parse(stored);
      Object.assign(params, config);
      console.log('Loaded config from localStorage');
      return;
    }
    
    // Then try file
    const response = await fetch(url);
    if (response.ok) {
      const config = await response.json();
      Object.assign(params, config);
      console.log('Loaded config from file:', url);
    }
  } catch (e) {
    console.log('No config file found, using defaults');
  }
}

function loadConfigDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const text = await file.text();
      try {
        const config = JSON.parse(text);
        Object.assign(params, config);
        
        // Update GUI
        gui.destroy();
        setupGUI(window.frame);
        
        console.log('Config loaded from file');
      } catch (err) {
        console.error('Invalid config file:', err);
        alert('Invalid config file');
      }
    }
  };
  input.click();
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (uniforms) uniforms.uPlane.value.copy(planeSizeAtZ0());
}

function planeSizeAtZ0() {
  const dist = Math.abs(camera.position.z - 0.0);
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dist;
  const width = height * camera.aspect;
  return new THREE.Vector2(width, height);
}

async function loadCellsBin(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  let o = 0;

  const MAGIC = dv.getUint32(o, true); o += 4;
  if (MAGIC !== 0x43454C31) throw new Error('Bad magic in cells.bin');
  const count = dv.getUint32(o, true); o += 4;
  const wCells = dv.getUint16(o, true); o += 2;
  const hCells = dv.getUint16(o, true); o += 2;
  const block = dv.getUint16(o, true); o += 2;
  o += 2; // flags

  const uvs = new Float32Array(count * 2);
  const colors = new Uint8Array(count * 4);

  for (let i = 0; i < count; i++) {
    uvs[i * 2 + 0] = dv.getFloat32(o, true); o += 4;
    uvs[i * 2 + 1] = 1.0 - dv.getFloat32(o, true); o += 4; // FLIP Y HERE
    colors[i * 4 + 0] = dv.getUint8(o++); // R
    colors[i * 4 + 1] = dv.getUint8(o++); // G
    colors[i * 4 + 2] = dv.getUint8(o++); // B
    colors[i * 4 + 3] = dv.getUint8(o++); // A
  }
  return { count, wCells, hCells, block, uvs, colors };
}

function fallbackCells() {
  const count = 5000, wCells = 100, hCells = 50, block = 4;
  const uvs = new Float32Array(count * 2);
  const colors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    uvs[i * 2 + 0] = Math.random();
    uvs[i * 2 + 1] = Math.random();
    colors[i * 4 + 0] = Math.random() * 255;
    colors[i * 4 + 1] = Math.random() * 255;
    colors[i * 4 + 2] = Math.random() * 255;
    colors[i * 4 + 3] = 255;
  }
  return { count, wCells, hCells, block, uvs, colors };
}

function makeInstancedParticles({ count, wCells, hCells, uvs, colors }) {
  // Create a single plane geometry that will be instanced
  const planeGeom = new THREE.PlaneGeometry(1, 1);
  
  // Create instanced buffer geometry
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = planeGeom.index;
  geometry.attributes.position = planeGeom.attributes.position;
  geometry.attributes.uv = planeGeom.attributes.uv;
  
  // Add instance attributes
  geometry.setAttribute('aInstanceUV', new THREE.InstancedBufferAttribute(uvs, 2));
  geometry.setAttribute('aInstanceColor', new THREE.InstancedBufferAttribute(new Uint8Array(colors), 4, true));
  
  // Random start positions
  const aStart = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 2.5 * Math.cbrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    aStart[i * 3 + 0] = r * Math.sin(ph) * Math.cos(th);
    aStart[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    aStart[i * 3 + 2] = r * Math.cos(ph);
  }
  geometry.setAttribute('aInstanceStart', new THREE.InstancedBufferAttribute(aStart, 3));
  
  // Fade system attributes
  // Create deterministic random order using seeded random
  const seedRandom = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  // Create particle order indices (deterministic shuffle based on position)
  const particleOrder = new Float32Array(count);
  const indices = Array.from({ length: count }, (_, i) => i);
  
  // Sort indices based on deterministic "random" value from particle position
  indices.sort((a, b) => {
    const randA = seedRandom(aStart[a * 3] * 12.9898 + aStart[a * 3 + 1] * 78.233 + aStart[a * 3 + 2] * 37.719);
    const randB = seedRandom(aStart[b * 3] * 12.9898 + aStart[b * 3 + 1] * 78.233 + aStart[b * 3 + 2] * 37.719);
    return randA - randB;
  });
  
  // Store the order index for each particle
  for (let i = 0; i < count; i++) {
    particleOrder[indices[i]] = i / count; // Normalized position in order (0-1)
  }
  geometry.setAttribute('aParticleOrder', new THREE.InstancedBufferAttribute(particleOrder, 1));
  
  // Current opacity for each particle (starts at 1)
  const aOpacity = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aOpacity[i] = 1.0;
  }
  geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
  
  // Target opacity (what we're fading to)
  const aTargetOpacity = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aTargetOpacity[i] = 1.0;
  }
  geometry.setAttribute('aTargetOpacity', new THREE.InstancedBufferAttribute(aTargetOpacity, 1));
  
  // Fade speed for each particle (deterministic based on index)
  const aFadeSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = seedRandom(i * 45.233 + 12.9898);
    const frames = params.fadeSpeedMin + t * (params.fadeSpeedMax - params.fadeSpeedMin);
    aFadeSpeed[i] = 1.0 / frames;
  }
  geometry.setAttribute('aFadeSpeed', new THREE.InstancedBufferAttribute(aFadeSpeed, 1));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0.5 },
    uPlane: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: wCells / hCells },
    uParticleSize: { value: params.particleSize },
    uSoftness: { value: params.softness },
    uEdgeFade: { value: params.edgeFade },
    uTurbulenceAmount: { value: params.turbulenceAmount },
    uTurbulenceSpeed: { value: params.turbulenceSpeed },
    uTurbulenceScale: { value: params.turbulenceScale },
    uVisiblePercentage: { value: params.visiblePercentage },
    uDeltaTime: { value: 0 }
  };

  const vertexShader = `
    attribute vec2 aInstanceUV;
    attribute vec3 aInstanceStart;
    attribute vec4 aInstanceColor;
    attribute float aOpacity;
    
    varying vec4 vColor;
    varying vec2 vUv;
    varying float vOpacity;

    uniform float uTime;
    uniform float uProgress;
    uniform float uImgAspect;
    uniform vec2 uPlane;
    uniform float uParticleSize;
    uniform float uTurbulenceAmount;
    uniform float uTurbulenceSpeed;
    uniform float uTurbulenceScale;

    vec3 n3(vec3 p){
      return vec3(
        sin(p.x + 1.7) + sin(p.y*1.3 + 2.1) + sin(p.z*0.7 + 4.2),
        sin(p.x*0.9 + 3.4) + sin(p.y + 5.2) + sin(p.z*1.1 + 1.3),
        sin(p.x*1.2 + 2.7) + sin(p.y*0.8 + 6.1) + sin(p.z + 0.9)
      ) * 0.33;
    }

    void main(){
      vColor = aInstanceColor;
      vUv = uv;
      vOpacity = aOpacity;

      // Map instance UV to image plane
      float planeAspect = uPlane.x / uPlane.y;
      vec2 p = aInstanceUV * 2.0 - 1.0;
      
      if (planeAspect > uImgAspect) {
        p.x *= (uImgAspect / planeAspect);
      } else {
        p.y *= (planeAspect / uImgAspect);
      }
      
      vec3 target = vec3(p * 0.5 * uPlane, 0.0);

      // Animated start position with controllable turbulence
      vec3 start = aInstanceStart;
      vec3 wobble = n3(start * uTurbulenceScale + uTime * uTurbulenceSpeed);
      vec3 turbulent = start + wobble * uTurbulenceAmount;

      // Interpolate between start and target
      float t = smoothstep(0.0, 1.0, uProgress);
      vec3 instancePos = mix(turbulent, target, t);

      // Billboard the particle to face camera
      vec4 mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
      mvPosition.xyz += position * uParticleSize;
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    varying vec4 vColor;
    varying vec2 vUv;
    varying float vOpacity;
    
    uniform float uSoftness;
    uniform float uEdgeFade;
    
    void main(){
      // Create circular particle
      vec2 center = vUv - 0.5;
      float dist = length(center) * 2.0;
      
      // Controllable soft edge - uSoftness controls where fade starts (0 = very soft, 1 = hard edge)
      float fadeStart = mix(0.0, 0.95, uSoftness);
      float fadeEnd = mix(fadeStart + 0.05, 1.0, uEdgeFade);
      
      float alpha = (1.0 - smoothstep(fadeStart, fadeEnd, dist)) * vOpacity;
      
      // Premultiply alpha for correct blending
      gl_FragColor = vec4(vColor.rgb * alpha, alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false, // Always false for proper soft particles
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  
  console.log(`Instanced particles created: ${count} instances`);
  
  return mesh;
}

function makeFrameHelper(planeVec2, imgAspect) {
  const planeAspect = planeVec2.x / planeVec2.y;
  let w = planeVec2.x * 0.5, h = planeVec2.y * 0.5;
  if (planeAspect > imgAspect) {
    w *= imgAspect / planeAspect;
  } else {
    h *= planeAspect / imgAspect;
  }
  const hw = w, hh = h;
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([
    -hw, -hh, 0, hw, -hh, 0,
    hw, -hh, 0, hw, hh, 0,
    hw, hh, 0, -hw, hh, 0,
    -hw, hh, 0, -hw, -hh, 0
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const m = new THREE.LineBasicMaterial({ color: 0x44ff88 });
  return new THREE.LineSegments(g, m);
}

// Update which particles should be visible based on percentage
function updateParticleTargets(geometry) {
  const count = geometry.attributes.aTargetOpacity.count;
  const targetOpacity = geometry.attributes.aTargetOpacity.array;
  const particleOrder = geometry.attributes.aParticleOrder.array;
  
  // Set target opacity based on particle order
  // Particles with order < visiblePercentage should be visible
  for (let i = 0; i < count; i++) {
    targetOpacity[i] = particleOrder[i] < params.visiblePercentage ? 1.0 : 0.0;
  }
  
  geometry.attributes.aTargetOpacity.needsUpdate = true;
}

// Update fade speeds when parameters change (keeps deterministic ratio)
function updateFadeSpeeds(geometry) {
  const count = geometry.attributes.aFadeSpeed.count;
  const fadeSpeed = geometry.attributes.aFadeSpeed.array;
  
  // Seeded random function
  const seedRandom = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  for (let i = 0; i < count; i++) {
    // Use deterministic random based on particle index
    const t = seedRandom(i * 45.233 + 12.9898);
    const frames = params.fadeSpeedMin + t * (params.fadeSpeedMax - params.fadeSpeedMin);
    fadeSpeed[i] = 1.0 / frames;
  }
  
  geometry.attributes.aFadeSpeed.needsUpdate = true;
}

// Update particle opacity every frame
function updateParticleVisibility(geometry, deltaTime) {
  const count = geometry.attributes.aOpacity.count;
  const opacity = geometry.attributes.aOpacity.array;
  const targetOpacity = geometry.attributes.aTargetOpacity.array;
  const fadeSpeed = geometry.attributes.aFadeSpeed.array;
  
  // Assuming 60 FPS for frame-based fade speed
  const frameMultiplier = deltaTime * 60;
  
  for (let i = 0; i < count; i++) {
    const diff = targetOpacity[i] - opacity[i];
    
    if (Math.abs(diff) > 0.001) {
      // Smooth transition towards target
      const step = fadeSpeed[i] * frameMultiplier;
      
      if (diff > 0) {
        opacity[i] = Math.min(opacity[i] + step, targetOpacity[i]);
      } else {
        opacity[i] = Math.max(opacity[i] - step, targetOpacity[i]);
      }
    }
  }
  
  geometry.attributes.aOpacity.needsUpdate = true;
}