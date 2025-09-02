// neue-gui.js — With lil-gui controls and JSON config
import * as THREE from 'three';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

const CELLS_URL = './public/cells.bin';
const CONFIG_URL = './config.json'; // Default config file

const canvas = document.getElementById('bg-splats');
const statsEl = document.getElementById('stats');

// Animation system
const animationSystem = {
  states: [
    { params: {}, duration: 0 },    // State 0 (no duration)
    { params: {}, duration: 2.0 },  // State 1
    { params: {}, duration: 2.0 },  // State 2
    { params: {}, duration: 2.0 },  // State 3
    { params: {}, duration: 2.0 }   // State 4
  ],
  currentState: 0,
  isPlaying: false,
  playStartTime: 0,
  currentPlayTime: 0
};

// Default parameters
const params = {
  particleSizeMin: 0.01, // Random size min
  particleSizeMax: 0.03, // Random size max
  particleSizeTarget: 0.015, // Fixed size at target
  movePercentage: 0.0, // 0-1, percentage of particles that should move to target
  orderingMode: 'random', // 'islands', 'random', 'radial', 'grid', 'spiral', 'horizontal', 'vertical'
  orderingScale: 1.0, // Scale of the ordering pattern
  turbulence1Amount: 1.2,
  turbulence1Speed: 0.6,
  turbulence1Scale: 0.9,
  turbulence1Evolution: 0.3, // Speed of moving through noise
  turbulence2Amount: 0.5,
  turbulence2Speed: 0.3,
  turbulence2Scale: 2.0,
  turbulence2Evolution: 0.2,
  softness: 0.2, // 0 = very soft, 1 = hard edge
  edgeFade: 0.5, // Controls fade range
  visiblePercentage: 1.0, // 0-1, percentage of particles that should be visible
  fadeSpeedMin: 30, // Min frames to fade (30 = 0.5 sec at 60fps)
  fadeSpeedMax: 120, // Max frames to fade (120 = 2 sec at 60fps)
  moveSpeedMin: 60, // Min frames to reach target position
  moveSpeedMax: 180, // Max frames to reach target position
  backgroundColor: '#111111',
  blendMode: 'premultiplied',
  depthWrite: false,
  showFrame: true
};

let renderer, scene, camera, particles, uniforms, clock, gui, guiNeedsUpdate = false;

init().catch(err => {
  console.error('Init error:', err);
  if (statsEl) statsEl.textContent = 'Init error (see console).';
});

async function init() {
  // Try to load config file
  await loadConfig(CONFIG_URL);
  
  // Try to load animation file
  await loadAnimationFile();

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
  
  // Store particle data for re-ordering
  window.particleData = data;

  uniforms = particles.material.uniforms;
  uniforms.uPlane.value.copy(planeSizeAtZ0());

  // Frame helper
  const frame = makeFrameHelper(uniforms.uPlane.value, data.wCells / data.hCells);
  frame.visible = params.showFrame;
  scene.add(frame);
  window.frame = frame;

  // Setup GUI
  setupGUI(frame);
  
  // Initialize particle visibility and movement
  updateParticleTargets(particles.geometry);
  updateMovementTargets(particles.geometry);

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
    
    // Update animation system
    updateAnimation();
    
    // Update particle visibility and movement
    updateParticleVisibility(particles.geometry, deltaTime);
    updateParticleMovement(particles.geometry, deltaTime);
    
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
  animFolder.add(params, 'movePercentage', 0, 1, 0.01)
    .name('Move to Target %')
    .onChange(v => {
      uniforms.uMovePercentage.value = v;
      updateMovementTargets(particles.geometry);
    });
  animFolder.add(params, 'orderingMode', ['islands', 'random', 'radial', 'spiral', 'grid', 'horizontal', 'vertical'])
    .name('Fill Pattern')
    .onChange(v => {
      updateParticleOrdering(particles.geometry, window.particleData);
      updateMovementTargets(particles.geometry);
      updateParticleTargets(particles.geometry);
    });
  animFolder.add(params, 'orderingScale', 0.1, 3, 0.01)
    .name('Pattern Scale')
    .onChange(v => {
      updateParticleOrdering(particles.geometry, window.particleData);
      updateMovementTargets(particles.geometry);
      updateParticleTargets(particles.geometry);
    });
  animFolder.add(params, 'moveSpeedMin', 1, 300, 1)
    .name('Move Speed Min (frames)')
    .onChange(v => {
      updateMoveSpeeds(particles.geometry);
    });
  animFolder.add(params, 'moveSpeedMax', 1, 300, 1)
    .name('Move Speed Max (frames)')
    .onChange(v => {
      updateMoveSpeeds(particles.geometry);
    });
  animFolder.open();

  // Particles folder
  const particleFolder = gui.addFolder('Particles');
  particleFolder.add(params, 'particleSizeMin', 0.001, 0.3, 0.001)
    .name('Random Size Min')
    .onChange(v => {
      updateParticleSizes(particles.geometry);
    });
  particleFolder.add(params, 'particleSizeMax', 0.001, 0.3, 0.001)
    .name('Random Size Max')
    .onChange(v => {
      updateParticleSizes(particles.geometry);
    });
  particleFolder.add(params, 'particleSizeTarget', 0.001, 0.3, 0.001)
    .name('Target Size')
    .onChange(v => {
      uniforms.uParticleSizeTarget.value = v;
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

  // Turbulence 1 folder
  const turb1Folder = gui.addFolder('Turbulence 1');
  turb1Folder.add(params, 'turbulence1Amount', 0, 5, 0.01)
    .name('Amount')
    .onChange(v => {
      uniforms.uTurbulence1Amount.value = v;
    });
  turb1Folder.add(params, 'turbulence1Speed', 0, 2, 0.01)
    .name('Speed')
    .onChange(v => {
      uniforms.uTurbulence1Speed.value = v;
    });
  turb1Folder.add(params, 'turbulence1Scale', 0.1, 5, 0.01)
    .name('Scale')
    .onChange(v => {
      uniforms.uTurbulence1Scale.value = v;
    });
  turb1Folder.add(params, 'turbulence1Evolution', 0, 2, 0.01)
    .name('Evolution')
    .onChange(v => {
      uniforms.uTurbulence1Evolution.value = v;
    });
  turb1Folder.open();
  
  // Turbulence 2 folder
  const turb2Folder = gui.addFolder('Turbulence 2');
  turb2Folder.add(params, 'turbulence2Amount', 0, 5, 0.01)
    .name('Amount')
    .onChange(v => {
      uniforms.uTurbulence2Amount.value = v;
    });
  turb2Folder.add(params, 'turbulence2Speed', 0, 2, 0.01)
    .name('Speed')
    .onChange(v => {
      uniforms.uTurbulence2Speed.value = v;
    });
  turb2Folder.add(params, 'turbulence2Scale', 0.1, 5, 0.01)
    .name('Scale')
    .onChange(v => {
      uniforms.uTurbulence2Scale.value = v;
    });
  turb2Folder.add(params, 'turbulence2Evolution', 0, 2, 0.01)
    .name('Evolution')
    .onChange(v => {
      uniforms.uTurbulence2Evolution.value = v;
    });
  turb2Folder.open();

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
  
  // Animation System folder
  const animSystemFolder = gui.addFolder('Animation System');
  
  // State selector
  animSystemFolder.add(animationSystem, 'currentState', {
    'State 0 (Start)': 0,
    'State 1': 1,
    'State 2': 2,
    'State 3': 3,
    'State 4 (End)': 4
  }).name('Current State').onChange(v => {
    // Stop animation when changing states
    if (animationSystem.isPlaying) {
      stopAnimation();
    }
    
    // Load the selected state
    const stateIndex = parseInt(v);
    loadAnimationState(stateIndex);
    
    // Update duration control for the selected state
    if (stateIndex > 0) {
      durationControl.enable();
      durationObj.duration = animationSystem.states[stateIndex].duration;
      durationControl.updateDisplay();
    } else {
      durationControl.disable();
    }
  });
  
  // Duration control (disabled for state 0)
  const durationObj = { duration: animationSystem.states[animationSystem.currentState].duration };
  const durationControl = animSystemFolder.add(
    durationObj,
    'duration', 0.1, 10, 0.1
  ).name('Duration (seconds)').onChange(v => {
    if (animationSystem.currentState > 0) {
      animationSystem.states[animationSystem.currentState].duration = v;
    }
  });
  
  // Disable duration for state 0
  if (animationSystem.currentState === 0) {
    durationControl.disable();
  }
  
  // Store current params to selected state
  animSystemFolder.add({
    store: () => storeAnimationState()
  }, 'store').name('Store Current Params');
  
  // Play button
  animSystemFolder.add({
    play: () => startAnimation()
  }, 'play').name('▶ Play');
  
  // Stop button
  animSystemFolder.add({
    stop: () => stopAnimation()
  }, 'stop').name('■ Stop');
  
  // Save/Load animation
  animSystemFolder.add({
    save: () => saveAnimation(true)  // Force download
  }, 'save').name('Save Animation (Download)');
  
  animSystemFolder.add({
    load: () => loadAnimationFromFile()
  }, 'load').name('Load Animation');
  
  // Progress display
  animSystemFolder.add({ progress: 0 }, 'progress', 0, 1)
    .name('Playback Progress')
    .listen()
    .disable();
  
  // Render controls
  animSystemFolder.add({
    renderMP4: () => startRendering()
  }, 'renderMP4').name('📹 Render MP4 (30fps)');
  
  animSystemFolder.add({
    renderFrames: () => startFrameExport()
  }, 'renderFrames').name('📸 Export Frames (JPG)');
  
  animSystemFolder.open();

  // Apply initial values
  uniforms.uParticleSizeTarget.value = params.particleSizeTarget;
  uniforms.uSoftness.value = params.softness;
  uniforms.uEdgeFade.value = params.edgeFade;
  uniforms.uTurbulence1Amount.value = params.turbulence1Amount;
  uniforms.uTurbulence1Speed.value = params.turbulence1Speed;
  uniforms.uTurbulence1Scale.value = params.turbulence1Scale;
  uniforms.uTurbulence1Evolution.value = params.turbulence1Evolution;
  uniforms.uTurbulence2Amount.value = params.turbulence2Amount;
  uniforms.uTurbulence2Speed.value = params.turbulence2Speed;
  uniforms.uTurbulence2Scale.value = params.turbulence2Scale;
  uniforms.uTurbulence2Evolution.value = params.turbulence2Evolution;

  // Add keyboard shortcuts
  let guiHidden = false;
  document.addEventListener('keydown', (event) => {
    // Spacebar: Play/Stop animation
    if (event.code === 'Space') {
      event.preventDefault(); // Prevent page scroll
      if (animationSystem.isPlaying) {
        stopAnimation();
      } else {
        startAnimation();
      }
    }

    // H key: Hide/Show GUI
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      if (guiHidden) {
        gui.show();
        guiHidden = false;
        console.log('GUI shown (press H to hide)');
      } else {
        gui.hide();
        guiHidden = true;
        console.log('GUI hidden (press H to show)');
      }
    }
  });

  console.log('Keyboard shortcuts: SPACE = Play/Stop, H = Hide/Show GUI');
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
  
  // Create TWO separate particle orders - one for visibility, one for movement
  const particleOrderVisibility = new Float32Array(count);
  const particleOrderMovement = new Float32Array(count);
  const indices = Array.from({ length: count }, (_, i) => i);
  
  // Function to calculate order value based on UV position
  const getOrderValue = (u, v, mode, scale) => {
    const x = (u - 0.5) * 2.0; // Convert to -1 to 1
    const y = (v - 0.5) * 2.0;
    
    switch(mode) {
      case 'radial':
        // Distance from center, creating concentric circles
        return Math.sqrt(x * x + y * y) * scale;
        
      case 'spiral':
        // Spiral pattern from center
        const angle = Math.atan2(y, x);
        const dist = Math.sqrt(x * x + y * y);
        return (dist * scale + (angle + Math.PI) / (2 * Math.PI)) % 1;
        
      case 'grid':
        // Grid-based zones
        const gridSize = Math.floor(5 * scale);
        const gx = Math.floor((u * gridSize));
        const gy = Math.floor((v * gridSize));
        // Add small random offset within grid cell for variety
        return (gy * gridSize + gx + seedRandom(gx * 17.23 + gy * 31.17) * 0.1) / (gridSize * gridSize);
        
      case 'horizontal':
        // Left to right waves
        return (u + Math.sin(v * Math.PI * 2 * scale) * 0.1);
        
      case 'vertical':
        // Top to bottom waves
        return (v + Math.sin(u * Math.PI * 2 * scale) * 0.1);
        
      case 'islands':
        // Voronoi-based organic blob zones with very heavy distortion
        const numCells = Math.floor(4 + 4 * scale); // 4-8 cells
        const cells = [];
        
        // Generate Voronoi cell centers
        for (let i = 0; i < numCells; i++) {
          cells.push({
            x: (seedRandom(i * 23.45) - 0.5) * 2,
            y: (seedRandom(i * 34.56 + 100) - 0.5) * 2,
            // Random fill priority - NOT based on position
            priority: seedRandom(i * 789.01)
          });
        }
        
        // Sort cells by priority so they fill in random order
        cells.sort((a, b) => a.priority - b.priority);
        
        // Create smooth noise function for organic distortion
        const smoothNoise = (px, py, seed) => {
          const ix = Math.floor(px);
          const iy = Math.floor(py);
          const fx = px - ix;
          const fy = py - iy;
          
          // Smooth interpolation curves
          const sx = fx * fx * (3 - 2 * fx);
          const sy = fy * fy * (3 - 2 * fy);
          
          const n00 = seedRandom(ix * 12.9898 + iy * 78.233 + seed);
          const n10 = seedRandom((ix + 1) * 12.9898 + iy * 78.233 + seed);
          const n01 = seedRandom(ix * 12.9898 + (iy + 1) * 78.233 + seed);
          const n11 = seedRandom((ix + 1) * 12.9898 + (iy + 1) * 78.233 + seed);
          
          const nx0 = n00 * (1 - sx) + n10 * sx;
          const nx1 = n01 * (1 - sx) + n11 * sx;
          
          return nx0 * (1 - sy) + nx1 * sy;
        };
        
        // Multi-scale smooth noise for very organic distortion
        const distortionAmount = 0.8; // Much stronger distortion
        
        // Multiple octaves of smooth noise at different scales
        const noise1 = smoothNoise(u * 5, v * 5, 123.45) - 0.5;
        const noise2 = smoothNoise(u * 10, v * 10, 234.56) - 0.5;
        const noise3 = smoothNoise(u * 20, v * 20, 345.67) - 0.5;
        const noise4 = smoothNoise(u * 40, v * 40, 456.78) - 0.5;
        
        // Combine noise octaves with decreasing amplitude
        const noiseX = noise1 * 0.5 + noise2 * 0.25 + noise3 * 0.125 + noise4 * 0.0625;
        const noiseY = smoothNoise(u * 5, v * 5, 567.89) * 0.5 - 0.25 +
                       smoothNoise(u * 10, v * 10, 678.90) * 0.25 - 0.125 +
                       smoothNoise(u * 20, v * 20, 789.01) * 0.125 - 0.0625;
        
        // Apply heavy distortion to break up angular edges
        const distortedX = x + noiseX * distortionAmount;
        const distortedY = y + noiseY * distortionAmount;
        
        // Find closest cell using heavily distorted position
        let closestCell = 0;
        let minDist = 999;
        let secondMinDist = 999;
        
        for (let i = 0; i < numCells; i++) {
          const dx = distortedX - cells[i].x;
          const dy = distortedY - cells[i].y;
          
          // Add additional radial noise distortion per cell
          const angle = Math.atan2(dy, dx);
          const radialNoise = smoothNoise(angle * 2, i * 10, i * 123.45) * 0.4;
          
          const dist = Math.sqrt(dx * dx + dy * dy) * (1.0 + radialNoise);
          
          if (dist < minDist) {
            secondMinDist = minDist;
            minDist = dist;
            closestCell = i;
          } else if (dist < secondMinDist) {
            secondMinDist = dist;
          }
        }
        
        // Final order: cell index determines fill order
        const cellOrder = closestCell / numCells;
        
        // Within each cell, add smooth organic variation
        const withinCellNoise = smoothNoise(u * 30, v * 30, closestCell * 100) * 0.08;
        
        return cellOrder + withinCellNoise;
        
      case 'random':
      default:
        // Original random ordering
        return seedRandom(u * 12.9898 + v * 78.233);
    }
  };
  
  // Sort indices for VISIBILITY order (using one random seed)
  const indicesVis = [...indices];
  indicesVis.sort((a, b) => {
    // Use a different seed for visibility ordering
    const orderA = seedRandom(uvs[a * 2] * 12.9898 + uvs[a * 2 + 1] * 78.233 + 1000);
    const orderB = seedRandom(uvs[b * 2] * 12.9898 + uvs[b * 2 + 1] * 78.233 + 1000);
    return orderA - orderB;
  });
  
  // Sort indices for MOVEMENT order (using different random seed)
  const indicesMove = [...indices];
  indicesMove.sort((a, b) => {
    // Use a different seed for movement ordering
    const orderA = seedRandom(uvs[a * 2] * 45.678 + uvs[a * 2 + 1] * 123.456 + 2000);
    const orderB = seedRandom(uvs[b * 2] * 45.678 + uvs[b * 2 + 1] * 123.456 + 2000);
    return orderA - orderB;
  });
  
  // Store both order indices for each particle
  for (let i = 0; i < count; i++) {
    particleOrderVisibility[indicesVis[i]] = i / count; // Normalized position in visibility order
    particleOrderMovement[indicesMove[i]] = i / count; // Normalized position in movement order
  }
  
  geometry.setAttribute('aParticleOrderVisibility', new THREE.InstancedBufferAttribute(particleOrderVisibility, 1));
  geometry.setAttribute('aParticleOrderMovement', new THREE.InstancedBufferAttribute(particleOrderMovement, 1));
  
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
  
  // Movement system attributes
  // Current progress for each particle (0 = start position, 1 = target position)
  const aProgress = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aProgress[i] = 0.0; // Start at turbulent position
  }
  geometry.setAttribute('aProgress', new THREE.InstancedBufferAttribute(aProgress, 1));
  
  // Target progress (what we're moving towards)
  const aTargetProgress = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aTargetProgress[i] = 0.0; // Initially not moving to target
  }
  geometry.setAttribute('aTargetProgress', new THREE.InstancedBufferAttribute(aTargetProgress, 1));
  
  // Movement speed for each particle (deterministic based on index)
  const aMoveSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = seedRandom(i * 67.891 + 23.456); // Different seed for movement
    const frames = params.moveSpeedMin + t * (params.moveSpeedMax - params.moveSpeedMin);
    aMoveSpeed[i] = 1.0 / frames;
  }
  geometry.setAttribute('aMoveSpeed', new THREE.InstancedBufferAttribute(aMoveSpeed, 1));
  
  // Random particle sizes (deterministic based on index)
  const aRandomSize = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = seedRandom(i * 89.123 + 45.678);
    aRandomSize[i] = params.particleSizeMin + t * (params.particleSizeMax - params.particleSizeMin);
  }
  geometry.setAttribute('aRandomSize', new THREE.InstancedBufferAttribute(aRandomSize, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPlane: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: wCells / hCells },
    uParticleSizeTarget: { value: params.particleSizeTarget },
    uSoftness: { value: params.softness },
    uEdgeFade: { value: params.edgeFade },
    uTurbulence1Amount: { value: params.turbulence1Amount },
    uTurbulence1Speed: { value: params.turbulence1Speed },
    uTurbulence1Scale: { value: params.turbulence1Scale },
    uTurbulence1Evolution: { value: params.turbulence1Evolution },
    uTurbulence2Amount: { value: params.turbulence2Amount },
    uTurbulence2Speed: { value: params.turbulence2Speed },
    uTurbulence2Scale: { value: params.turbulence2Scale },
    uTurbulence2Evolution: { value: params.turbulence2Evolution },
    uVisiblePercentage: { value: params.visiblePercentage },
    uMovePercentage: { value: params.movePercentage },
    uDeltaTime: { value: 0 }
  };

  const vertexShader = `
    attribute vec2 aInstanceUV;
    attribute vec3 aInstanceStart;
    attribute vec4 aInstanceColor;
    attribute float aOpacity;
    attribute float aProgress;
    attribute float aRandomSize;
    
    varying vec4 vColor;
    varying vec2 vUv;
    varying float vOpacity;

    uniform float uTime;
    uniform float uImgAspect;
    uniform vec2 uPlane;
    uniform float uParticleSizeTarget;
    uniform float uTurbulence1Amount;
    uniform float uTurbulence1Speed;
    uniform float uTurbulence1Scale;
    uniform float uTurbulence1Evolution;
    uniform float uTurbulence2Amount;
    uniform float uTurbulence2Speed;
    uniform float uTurbulence2Scale;
    uniform float uTurbulence2Evolution;

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

      // Two layers of turbulence with evolution
      vec3 start = aInstanceStart;
      
      // First turbulence layer - evolves through noise space
      vec3 noiseCoord1 = start * uTurbulence1Scale + vec3(0.0, 0.0, uTime * uTurbulence1Evolution);
      vec3 wobble1 = n3(noiseCoord1 + uTime * uTurbulence1Speed) * uTurbulence1Amount;
      
      // Second turbulence layer - different scale and evolution
      vec3 noiseCoord2 = start * uTurbulence2Scale + vec3(0.0, 0.0, uTime * uTurbulence2Evolution);
      vec3 wobble2 = n3(noiseCoord2 * 1.7 + uTime * uTurbulence2Speed + 100.0) * uTurbulence2Amount;
      
      vec3 turbulent = start + wobble1 + wobble2;

      // Use per-particle progress (already smoothstepped in JavaScript)
      vec3 instancePos = mix(turbulent, target, aProgress);

      // Interpolate particle size based on progress
      float particleSize = mix(aRandomSize, uParticleSizeTarget, aProgress);

      // Billboard the particle to face camera
      vec4 mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
      mvPosition.xyz += position * particleSize;
      
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
  const particleOrderVisibility = geometry.attributes.aParticleOrderVisibility.array;
  
  // Set target opacity based on VISIBILITY particle order
  // Particles with order < visiblePercentage should be visible
  for (let i = 0; i < count; i++) {
    targetOpacity[i] = particleOrderVisibility[i] < params.visiblePercentage ? 1.0 : 0.0;
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

// Smoothstep function for S-curve interpolation
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Update particle opacity every frame with S-curve
function updateParticleVisibility(geometry, deltaTime) {
  const count = geometry.attributes.aOpacity.count;
  const opacity = geometry.attributes.aOpacity.array;
  const targetOpacity = geometry.attributes.aTargetOpacity.array;
  const fadeSpeed = geometry.attributes.aFadeSpeed.array;
  
  // Assuming 60 FPS for frame-based fade speed
  const frameMultiplier = deltaTime * 60;
  
  // Store internal progress for S-curve (would be better as attribute but minimizing changes)
  if (!geometry.userData.fadeProgress) {
    geometry.userData.fadeProgress = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      geometry.userData.fadeProgress[i] = opacity[i]; // Initialize with current opacity
    }
  }
  const fadeProgress = geometry.userData.fadeProgress;
  
  for (let i = 0; i < count; i++) {
    const target = targetOpacity[i];
    const current = opacity[i];
    const diff = target - current;
    
    if (Math.abs(diff) > 0.001) {
      // Update linear progress
      const step = fadeSpeed[i] * frameMultiplier;
      
      if (diff > 0) {
        fadeProgress[i] = Math.min(fadeProgress[i] + step, 1.0);
      } else {
        fadeProgress[i] = Math.max(fadeProgress[i] - step, 0.0);
      }
      
      // Apply S-curve to the progress
      if (target > 0.5) {
        // Fading in: use smoothstep from 0 to 1
        opacity[i] = smoothstep(0, 1, fadeProgress[i]);
      } else {
        // Fading out: use smoothstep from 1 to 0
        opacity[i] = smoothstep(0, 1, fadeProgress[i]);
      }
    } else {
      fadeProgress[i] = target; // Sync progress when reached target
    }
  }
  
  geometry.attributes.aOpacity.needsUpdate = true;
}

// Update movement targets based on percentage (like opacity)
function updateMovementTargets(geometry) {
  const count = geometry.attributes.aTargetProgress.count;
  const targetProgress = geometry.attributes.aTargetProgress.array;
  const particleOrderMovement = geometry.attributes.aParticleOrderMovement.array;
  
  // Set target progress based on MOVEMENT particle order
  // Particles with order < movePercentage should move to target
  for (let i = 0; i < count; i++) {
    targetProgress[i] = particleOrderMovement[i] < params.movePercentage ? 1.0 : 0.0;
  }
  
  geometry.attributes.aTargetProgress.needsUpdate = true;
}

// Update move speeds when parameters change (keeps deterministic ratio)
function updateMoveSpeeds(geometry) {
  const count = geometry.attributes.aMoveSpeed.count;
  const moveSpeed = geometry.attributes.aMoveSpeed.array;
  
  // Seeded random function
  const seedRandom = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  for (let i = 0; i < count; i++) {
    // Use deterministic random based on particle index
    const t = seedRandom(i * 67.891 + 23.456);
    const frames = params.moveSpeedMin + t * (params.moveSpeedMax - params.moveSpeedMin);
    moveSpeed[i] = 1.0 / frames;
  }
  
  geometry.attributes.aMoveSpeed.needsUpdate = true;
}

// Update particle movement every frame with S-curve
function updateParticleMovement(geometry, deltaTime) {
  const count = geometry.attributes.aProgress.count;
  const progress = geometry.attributes.aProgress.array;
  const targetProgress = geometry.attributes.aTargetProgress.array;
  const moveSpeed = geometry.attributes.aMoveSpeed.array;
  
  // Assuming 60 FPS for frame-based move speed
  const frameMultiplier = deltaTime * 60;
  
  // Store internal progress for S-curve
  if (!geometry.userData.moveProgress) {
    geometry.userData.moveProgress = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      geometry.userData.moveProgress[i] = progress[i]; // Initialize with current progress
    }
  }
  const moveProgress = geometry.userData.moveProgress;
  
  for (let i = 0; i < count; i++) {
    const target = targetProgress[i];
    const current = progress[i];
    const diff = target - current;
    
    if (Math.abs(diff) > 0.001) {
      // Update linear progress
      const step = moveSpeed[i] * frameMultiplier;
      
      if (diff > 0) {
        moveProgress[i] = Math.min(moveProgress[i] + step, 1.0);
      } else {
        moveProgress[i] = Math.max(moveProgress[i] - step, 0.0);
      }
      
      // Apply S-curve to the progress for smooth acceleration/deceleration
      if (target > 0.5) {
        // Moving to target: use smoothstep
        progress[i] = smoothstep(0, 1, moveProgress[i]);
      } else {
        // Moving back to turbulent: use smoothstep
        progress[i] = smoothstep(0, 1, moveProgress[i]);
      }
    } else {
      moveProgress[i] = target; // Sync progress when reached target
    }
  }
  
  geometry.attributes.aProgress.needsUpdate = true;
}

// Update particle sizes when parameters change
function updateParticleSizes(geometry) {
  const count = geometry.attributes.aRandomSize.count;
  const randomSize = geometry.attributes.aRandomSize.array;
  
  // Seeded random function
  const seedRandom = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  for (let i = 0; i < count; i++) {
    // Use deterministic random based on particle index
    const t = seedRandom(i * 89.123 + 45.678);
    randomSize[i] = params.particleSizeMin + t * (params.particleSizeMax - params.particleSizeMin);
  }
  
  geometry.attributes.aRandomSize.needsUpdate = true;
}

// Animation System Functions

// Store current params to selected state
function storeAnimationState() {
  const state = animationSystem.currentState;
  
  // Store ALL params when manually storing
  animationSystem.states[state].params = JSON.parse(JSON.stringify(params));
  console.log(`Stored current params to state ${state}`);
  
  // Save to localStorage only (don't download every time)
  const animData = {
    states: animationSystem.states,
    version: 1
  };
  localStorage.setItem('particleAnimation', JSON.stringify(animData, null, 2));
}

// Rendering System

let renderState = {
  isRendering: false,
  frameRate: 30,
  currentFrame: 0,
  totalFrames: 0,
  startTime: 0,
  capturedFrames: [],
  recorder: null,
  stream: null
};

// Start MP4 rendering using MediaRecorder
async function startRendering() {
  if (renderState.isRendering) {
    console.log('Already rendering');
    return;
  }
  
  // Check if we have animation states
  let hasStates = false;
  for (let i = 0; i < 5; i++) {
    if (animationSystem.states[i].params && Object.keys(animationSystem.states[i].params).length > 0) {
      hasStates = true;
      break;
    }
  }
  
  if (!hasStates) {
    alert('Please store parameters in states before rendering');
    return;
  }
  
  // Calculate total duration and frames
  let totalDuration = 0;
  for (let i = 1; i < 5; i++) {
    totalDuration += animationSystem.states[i].duration;
  }
  
  renderState.totalFrames = Math.ceil(totalDuration * renderState.frameRate);
  renderState.currentFrame = 0;
  renderState.isRendering = true;
  
  console.log(`Starting render: ${renderState.totalFrames} frames at ${renderState.frameRate}fps`);
  
  try {
    // Create a MediaRecorder from canvas
    const stream = canvas.captureStream(renderState.frameRate);
    renderState.stream = stream;
    
    const options = {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 8000000 // 8 Mbps
    };
    
    // Fall back to other codecs if vp9 not supported
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }
    
    renderState.recorder = new MediaRecorder(stream, options);
    renderState.capturedFrames = [];
    
    renderState.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        renderState.capturedFrames.push(event.data);
      }
    };
    
    renderState.recorder.onstop = () => {
      // Create video blob and download
      const blob = new Blob(renderState.capturedFrames, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `particle-animation-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log('Render complete - video downloaded');
      
      // Clean up
      renderState.isRendering = false;
      renderState.capturedFrames = [];
      renderState.recorder = null;
      renderState.stream = null;
      
      // Return to state 0
      stopAnimation();
    };
    
    // Start recording
    renderState.recorder.start();
    
    // Start frame-by-frame playback
    renderFrameByFrame();
    
  } catch (err) {
    console.error('Error starting render:', err);
    alert('Error starting render. Check console for details.');
    renderState.isRendering = false;
  }
}

// Render animation frame by frame
function renderFrameByFrame() {
  if (!renderState.isRendering) return;
  
  const frameTime = renderState.currentFrame / renderState.frameRate;
  
  // Calculate total duration
  let totalDuration = 0;
  for (let i = 1; i < 5; i++) {
    totalDuration += animationSystem.states[i].duration;
  }
  
  if (frameTime >= totalDuration) {
    // Rendering complete
    console.log('All frames rendered');
    if (renderState.recorder && renderState.recorder.state === 'recording') {
      renderState.recorder.stop();
    }
    return;
  }
  
  // Find which states we're between at this frame time
  let accumulatedTime = 0;
  let fromState = 0;
  let toState = 1;
  let stateProgress = 0;
  
  for (let i = 1; i < 5; i++) {
    const stateDuration = animationSystem.states[i].duration;
    
    if (frameTime < accumulatedTime + stateDuration) {
      fromState = i - 1;
      toState = i;
      stateProgress = (frameTime - accumulatedTime) / stateDuration;
      break;
    }
    
    accumulatedTime += stateDuration;
    
    if (i === 4 && frameTime >= accumulatedTime) {
      fromState = 3;
      toState = 4;
      stateProgress = 1;
    }
  }
  
  // Interpolate states for this frame
  interpolateStates(fromState, toState, stateProgress);
  
  // Update time-based uniforms
  uniforms.uTime.value = frameTime;
  
  // Force render
  renderer.render(scene, camera);
  
  // Update progress
  const progress = renderState.currentFrame / renderState.totalFrames;
  console.log(`Rendering frame ${renderState.currentFrame + 1}/${renderState.totalFrames} (${Math.round(progress * 100)}%)`);
  
  renderState.currentFrame++;
  
  // Schedule next frame
  requestAnimationFrame(() => renderFrameByFrame());
}

// Export individual frames as PNG files with deterministic timing
async function startFrameExport() {
  if (renderState.isRendering) {
    console.log('Already rendering');
    return;
  }

  // Check if we have animation states
  let hasStates = false;
  for (let i = 0; i < 5; i++) {
    if (animationSystem.states[i].params && Object.keys(animationSystem.states[i].params).length > 0) {
      hasStates = true;
      break;
    }
  }

  if (!hasStates) {
    alert('Please store parameters in states before rendering');
    return;
  }

  // Calculate total duration and frames
  let totalDuration = 0;
  for (let i = 1; i < 5; i++) {
    totalDuration += animationSystem.states[i].duration;
  }

  const totalFrames = Math.ceil(totalDuration * renderState.frameRate);

  if (!confirm(`This will export ${totalFrames} JPEG frames. Continue?`)) {
    return;
  }

  renderState.isRendering = true;
  console.log(`Starting frame export: ${totalFrames} frames at ${renderState.frameRate}fps`);

  // Use deterministic frame timing - no delays, just sequential processing
  for (let frame = 0; frame < totalFrames; frame++) {
    const frameTime = frame / renderState.frameRate;

    // Find which states we're between
    let accumulatedTime = 0;
    let fromState = 0;
    let toState = 1;
    let stateProgress = 0;

    for (let i = 1; i < 5; i++) {
      const stateDuration = animationSystem.states[i].duration;

      if (frameTime < accumulatedTime + stateDuration) {
        fromState = i - 1;
        toState = i;
        stateProgress = (frameTime - accumulatedTime) / stateDuration;
        break;
      }

      accumulatedTime += stateDuration;

      if (i === 4 && frameTime >= accumulatedTime) {
        fromState = 3;
        toState = 4;
        stateProgress = 1;
      }
    }

    // Interpolate states
    interpolateStates(fromState, toState, stateProgress);

    // Update time to exact frame time
    uniforms.uTime.value = frameTime;

    // Render frame at exact time
    renderer.render(scene, camera);

    // Export frame as JPEG synchronously
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frame_${String(frame).padStart(5, '0')}.jpg`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`Exported frame ${frame + 1}/${totalFrames}`);
  }

  renderState.isRendering = false;
  console.log('Frame export complete');

  // Return to state 0
  stopAnimation();
}

// Load params from selected state
function loadAnimationState(stateIndex) {
  const state = animationSystem.states[stateIndex];
  animationSystem.currentState = stateIndex;
  
  if (state.params && Object.keys(state.params).length > 0) {
    // Update each param individually so GUI sees the changes
    for (const key in state.params) {
      if (params.hasOwnProperty(key)) {
        params[key] = state.params[key];
      }
    }
    
    // Update all uniforms and controls
    applyAllParams();
    
    // Force GUI to update all displays
    if (gui) {
      gui.controllersRecursive().forEach(c => c.updateDisplay());
    }
    
    console.log(`Loaded state ${stateIndex}`);
  } else {
    console.log(`State ${stateIndex} is empty`);
  }
}



// Apply all params to uniforms and geometry
function applyAllParams() {
  if (!uniforms || !particles) return;
  
  // Apply ALL uniforms (including non-animatable ones)
  uniforms.uParticleSizeTarget.value = params.particleSizeTarget;
  uniforms.uSoftness.value = params.softness;
  uniforms.uEdgeFade.value = params.edgeFade;
  uniforms.uTurbulence1Amount.value = params.turbulence1Amount;
  uniforms.uTurbulence1Speed.value = params.turbulence1Speed;
  uniforms.uTurbulence1Scale.value = params.turbulence1Scale;
  uniforms.uTurbulence1Evolution.value = params.turbulence1Evolution;
  uniforms.uTurbulence2Amount.value = params.turbulence2Amount;
  uniforms.uTurbulence2Speed.value = params.turbulence2Speed;
  uniforms.uTurbulence2Scale.value = params.turbulence2Scale;
  uniforms.uTurbulence2Evolution.value = params.turbulence2Evolution;
  uniforms.uVisiblePercentage.value = params.visiblePercentage;
  uniforms.uMovePercentage.value = params.movePercentage;
  
  // Apply other params
  renderer.setClearColor(params.backgroundColor);
  
  // Update blend mode
  switch(params.blendMode) {
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
  
  // Update frame visibility
  if (window.frame) {
    window.frame.visible = params.showFrame;
  }
  
  // Update particle targets
  updateParticleTargets(particles.geometry);
  updateMovementTargets(particles.geometry);
  updateParticleSizes(particles.geometry);
  updateMoveSpeeds(particles.geometry);
  updateFadeSpeeds(particles.geometry);
}

// Apply only animatable parameters (for animation playback)
function applyAnimatableParams() {
  if (!uniforms || !particles) return;
  
  // Apply ONLY the animatable uniforms (NO size parameters)
  uniforms.uTurbulence1Amount.value = params.turbulence1Amount;
  uniforms.uTurbulence1Speed.value = params.turbulence1Speed;
  uniforms.uTurbulence1Scale.value = params.turbulence1Scale;
  uniforms.uTurbulence1Evolution.value = params.turbulence1Evolution;
  uniforms.uTurbulence2Amount.value = params.turbulence2Amount;
  uniforms.uTurbulence2Speed.value = params.turbulence2Speed;
  uniforms.uTurbulence2Scale.value = params.turbulence2Scale;
  uniforms.uTurbulence2Evolution.value = params.turbulence2Evolution;
  uniforms.uVisiblePercentage.value = params.visiblePercentage;
  uniforms.uMovePercentage.value = params.movePercentage;
  
  // Update particle targets for visibility and movement
  updateParticleTargets(particles.geometry);
  updateMovementTargets(particles.geometry);
  
  // DO NOT update particle sizes, softness, edge fade, etc.
}

// Start animation playback
function startAnimation() {
  // Check if we have states with params
  let hasStates = false;
  for (let i = 0; i < 5; i++) {
    if (animationSystem.states[i].params && Object.keys(animationSystem.states[i].params).length > 0) {
      hasStates = true;
      break;
    }
  }
  
  if (!hasStates) {
    alert('Please store parameters in states before playing animation');
    return;
  }
  
  // Start from state 0
  if (animationSystem.states[0].params && Object.keys(animationSystem.states[0].params).length > 0) {
    loadAnimationState(0);
  }
  
  animationSystem.isPlaying = true;
  animationSystem.playStartTime = performance.now() / 1000;
  animationSystem.currentPlayTime = 0;
  console.log('Animation started');
}

// Stop animation playback and return to state 0
function stopAnimation() {
  animationSystem.isPlaying = false;
  animationSystem.currentPlayTime = 0;
  
  // Return to state 0
  if (animationSystem.states[0].params && Object.keys(animationSystem.states[0].params).length > 0) {
    loadAnimationState(0);
  }
  
  // Update progress display to 0
  const progressControl = gui.controllers.find(c => c.property === 'progress');
  if (progressControl) {
    progressControl.object.progress = 0;
  }
  
  console.log('Animation stopped - returned to state 0');
}

// Update animation (call this in render loop)
function updateAnimation() {
  if (!animationSystem.isPlaying) return;
  
  const currentTime = performance.now() / 1000;
  const elapsed = currentTime - animationSystem.playStartTime;
  
  // Calculate total duration
  let totalDuration = 0;
  for (let i = 1; i < 5; i++) {
    totalDuration += animationSystem.states[i].duration;
  }
  
  // Check if animation is complete
  if (elapsed >= totalDuration) {
    // Animation complete - stop and stay at state 4
    animationSystem.isPlaying = false;
    animationSystem.currentPlayTime = totalDuration;
    
    // Load final state
    if (animationSystem.states[4].params && Object.keys(animationSystem.states[4].params).length > 0) {
      loadAnimationState(4);
    }
    
    // Update progress display to 100%
    const progressControl = gui.controllers.find(c => c.property === 'progress');
    if (progressControl) {
      progressControl.object.progress = 1;
    }
    
    console.log('Animation complete');
    return;
  }
  
  animationSystem.currentPlayTime = elapsed;
  
  // Find which states we're between
  let accumulatedTime = 0;
  let fromState = 0;
  let toState = 1;
  let stateProgress = 0;
  
  for (let i = 1; i < 5; i++) {
    const stateDuration = animationSystem.states[i].duration;
    
    if (animationSystem.currentPlayTime < accumulatedTime + stateDuration) {
      fromState = i - 1;
      toState = i;
      stateProgress = (animationSystem.currentPlayTime - accumulatedTime) / stateDuration;
      break;
    }
    
    accumulatedTime += stateDuration;
    
    // If we're past state 3, interpolate from 3 to 4
    if (i === 4 && animationSystem.currentPlayTime >= accumulatedTime) {
      fromState = 3;
      toState = 4;
      stateProgress = 1;
    }
  }
  
  // Interpolate between states
  interpolateStates(fromState, toState, stateProgress);
  
  // Update progress display
  const progressControl = gui.controllers.find(c => c.property === 'progress');
  if (progressControl) {
    progressControl.object.progress = animationSystem.currentPlayTime / totalDuration;
  }
}

// Interpolate between two states
function interpolateStates(fromIndex, toIndex, t) {
  const from = animationSystem.states[fromIndex].params;
  const to = animationSystem.states[toIndex].params;
  
  if (!from || !to || Object.keys(from).length === 0 || Object.keys(to).length === 0) return;
  
  // Use smoothstep for smoother transitions
  const smoothT = t * t * (3 - 2 * t);
  
  // Only animate specific parameters - NO SIZE PARAMETERS
  const animatableParams = [
    'movePercentage',           // Target %
    'visiblePercentage',        // Visibility %
    'turbulence1Amount',
    'turbulence1Speed',
    'turbulence1Scale',
    'turbulence1Evolution',
    'turbulence2Amount',
    'turbulence2Speed',
    'turbulence2Scale',
    'turbulence2Evolution'
  ];
  
  // Store non-animatable params from state 0 to preserve them
  const preservedParams = ['particleSizeMin', 'particleSizeMax', 'particleSizeTarget', 
                          'softness', 'edgeFade', 'fadeSpeedMin', 'fadeSpeedMax',
                          'moveSpeedMin', 'moveSpeedMax', 'orderingMode', 'orderingScale',
                          'backgroundColor', 'blendMode', 'showFrame'];
  
  // Interpolate only animatable parameters
  for (const key of animatableParams) {
    if (from.hasOwnProperty(key) && to.hasOwnProperty(key) && 
        typeof from[key] === 'number' && typeof to[key] === 'number') {
      params[key] = from[key] + (to[key] - from[key]) * smoothT;
    }
  }
  
  // Apply interpolated params
  applyAnimatableParams();
}

// Interpolate between two hex colors
function interpolateColor(color1, color2, t) {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);
  
  const r1 = (c1 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff;
  const b1 = c1 & 0xff;
  
  const r2 = (c2 >> 16) & 0xff;
  const g2 = (c2 >> 8) & 0xff;
  const b2 = c2 & 0xff;
  
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Save animation to file
let saveAttempted = false;
async function saveAnimation(forceDownload = false) {
  const animData = {
    states: animationSystem.states,
    version: 1
  };
  
  const json = JSON.stringify(animData, null, 2);
  
  // Always save to localStorage
  localStorage.setItem('particleAnimation', json);
  console.log('Animation saved to localStorage');
  
  // If force download or we know server doesn't support PUT
  if (forceDownload || saveAttempted) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'anim.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log('Animation downloaded as anim.json');
    return;
  }
  
  // Try server save only once
  if (!saveAttempted) {
    saveAttempted = true;
    try {
      const response = await fetch('./anim.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json
      });
      
      if (!response.ok) {
        throw new Error('Server does not support PUT');
      }
      
      console.log('Animation saved to server');
    } catch (e) {
      // Server doesn't support PUT, will use localStorage/download from now on
      console.log('Server save not available, using localStorage. Use "Save Animation" button to download file.');
    }
  }
}

// Load animation from file
async function loadAnimationFile() {
  // First try localStorage
  const stored = localStorage.getItem('particleAnimation');
  if (stored) {
    try {
      const animData = JSON.parse(stored);
      animationSystem.states = animData.states;
      console.log('Animation loaded from localStorage');
      
      // Load first state
      if (animationSystem.states[0].params && Object.keys(animationSystem.states[0].params).length > 0) {
        loadAnimationState(0);
      }
      return;
    } catch (e) {
      console.error('Failed to parse stored animation:', e);
    }
  }
  
  // Try to load from file
  try {
    const response = await fetch('./anim.json');
    if (response.ok) {
      const animData = await response.json();
      animationSystem.states = animData.states;
      console.log('Animation loaded from anim.json');
      
      // Load first state
      if (animationSystem.states[0].params && Object.keys(animationSystem.states[0].params).length > 0) {
        loadAnimationState(0);
      }
    }
  } catch (e) {
    console.log('No animation file found');
  }
}

// Load animation from file chooser
function loadAnimationFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const text = await file.text();
      try {
        const animData = JSON.parse(text);
        if (animData.states && Array.isArray(animData.states)) {
          animationSystem.states = animData.states;
          console.log('Animation loaded from file:', file.name);

          // Load first state if it exists
          if (animationSystem.states[0] && animationSystem.states[0].params &&
              Object.keys(animationSystem.states[0].params).length > 0) {
            loadAnimationState(0);
          }

          // Update GUI to reflect loaded states
          if (gui) {
            gui.controllersRecursive().forEach(c => c.updateDisplay());
          }
        } else {
          throw new Error('Invalid animation file format');
        }
      } catch (err) {
        console.error('Failed to load animation file:', err);
        alert('Invalid animation file. Please select a valid JSON animation file.');
      }
    }
  };
  input.click();
}

// Update particle ordering when mode or scale changes
function updateParticleOrdering(geometry, data) {
  if (!data || !data.uvs) return;
  
  const count = geometry.attributes.aParticleOrderVisibility.count;
  const particleOrderVisibility = geometry.attributes.aParticleOrderVisibility.array;
  const particleOrderMovement = geometry.attributes.aParticleOrderMovement.array;
  const uvs = data.uvs;
  const indices = Array.from({ length: count }, (_, i) => i);
  
  // Seeded random function
  const seedRandom = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  // Function to calculate order value based on UV position
  const getOrderValue = (u, v, mode, scale) => {
    const x = (u - 0.5) * 2.0; // Convert to -1 to 1
    const y = (v - 0.5) * 2.0;
    
    switch(mode) {
      case 'radial':
        // Distance from center, creating concentric circles
        return Math.sqrt(x * x + y * y) * scale;
        
      case 'spiral':
        // Spiral pattern from center
        const angle = Math.atan2(y, x);
        const dist = Math.sqrt(x * x + y * y);
        return (dist * scale + (angle + Math.PI) / (2 * Math.PI)) % 1;
        
      case 'grid':
        // Grid-based zones
        const gridSize = Math.floor(5 * scale);
        const gx = Math.floor((u * gridSize));
        const gy = Math.floor((v * gridSize));
        // Add small random offset within grid cell for variety
        return (gy * gridSize + gx + seedRandom(gx * 17.23 + gy * 31.17) * 0.1) / (gridSize * gridSize);
        
      case 'horizontal':
        // Left to right waves
        return (u + Math.sin(v * Math.PI * 2 * scale) * 0.1);
        
      case 'vertical':
        // Top to bottom waves
        return (v + Math.sin(u * Math.PI * 2 * scale) * 0.1);
        
      case 'islands':
        // Voronoi-based organic blob zones with very heavy distortion
        const numCells = Math.floor(4 + 4 * scale); // 4-8 cells
        const cells = [];
        
        // Generate Voronoi cell centers
        for (let i = 0; i < numCells; i++) {
          cells.push({
            x: (seedRandom(i * 23.45) - 0.5) * 2,
            y: (seedRandom(i * 34.56 + 100) - 0.5) * 2,
            // Random fill priority - NOT based on position
            priority: seedRandom(i * 789.01)
          });
        }
        
        // Sort cells by priority so they fill in random order
        cells.sort((a, b) => a.priority - b.priority);
        
        // Create smooth noise function for organic distortion
        const smoothNoise = (px, py, seed) => {
          const ix = Math.floor(px);
          const iy = Math.floor(py);
          const fx = px - ix;
          const fy = py - iy;
          
          // Smooth interpolation curves
          const sx = fx * fx * (3 - 2 * fx);
          const sy = fy * fy * (3 - 2 * fy);
          
          const n00 = seedRandom(ix * 12.9898 + iy * 78.233 + seed);
          const n10 = seedRandom((ix + 1) * 12.9898 + iy * 78.233 + seed);
          const n01 = seedRandom(ix * 12.9898 + (iy + 1) * 78.233 + seed);
          const n11 = seedRandom((ix + 1) * 12.9898 + (iy + 1) * 78.233 + seed);
          
          const nx0 = n00 * (1 - sx) + n10 * sx;
          const nx1 = n01 * (1 - sx) + n11 * sx;
          
          return nx0 * (1 - sy) + nx1 * sy;
        };
        
        // Multi-scale smooth noise for very organic distortion
        const distortionAmount = 0.8; // Much stronger distortion
        
        // Multiple octaves of smooth noise at different scales
        const noise1 = smoothNoise(u * 5, v * 5, 123.45) - 0.5;
        const noise2 = smoothNoise(u * 10, v * 10, 234.56) - 0.5;
        const noise3 = smoothNoise(u * 20, v * 20, 345.67) - 0.5;
        const noise4 = smoothNoise(u * 40, v * 40, 456.78) - 0.5;
        
        // Combine noise octaves with decreasing amplitude
        const noiseX = noise1 * 0.5 + noise2 * 0.25 + noise3 * 0.125 + noise4 * 0.0625;
        const noiseY = smoothNoise(u * 5, v * 5, 567.89) * 0.5 - 0.25 +
                       smoothNoise(u * 10, v * 10, 678.90) * 0.25 - 0.125 +
                       smoothNoise(u * 20, v * 20, 789.01) * 0.125 - 0.0625;
        
        // Apply heavy distortion to break up angular edges
        const distortedX = x + noiseX * distortionAmount;
        const distortedY = y + noiseY * distortionAmount;
        
        // Find closest cell using heavily distorted position
        let closestCell = 0;
        let minDist = 999;
        let secondMinDist = 999;
        
        for (let i = 0; i < numCells; i++) {
          const dx = distortedX - cells[i].x;
          const dy = distortedY - cells[i].y;
          
          // Add additional radial noise distortion per cell
          const angle = Math.atan2(dy, dx);
          const radialNoise = smoothNoise(angle * 2, i * 10, i * 123.45) * 0.4;
          
          const dist = Math.sqrt(dx * dx + dy * dy) * (1.0 + radialNoise);
          
          if (dist < minDist) {
            secondMinDist = minDist;
            minDist = dist;
            closestCell = i;
          } else if (dist < secondMinDist) {
            secondMinDist = dist;
          }
        }
        
        // Final order: cell index determines fill order
        const cellOrder = closestCell / numCells;
        
        // Within each cell, add smooth organic variation
        const withinCellNoise = smoothNoise(u * 30, v * 30, closestCell * 100) * 0.08;
        
        return cellOrder + withinCellNoise;
        
      case 'random':
      default:
        // Original random ordering
        return seedRandom(u * 12.9898 + v * 78.233);
    }
  };
  
  // For 'random' mode, use different seeds for visibility and movement
  if (params.orderingMode === 'random') {
    // Sort indices for VISIBILITY order
    const indicesVis = [...indices];
    indicesVis.sort((a, b) => {
      const orderA = seedRandom(uvs[a * 2] * 12.9898 + uvs[a * 2 + 1] * 78.233 + 1000);
      const orderB = seedRandom(uvs[b * 2] * 12.9898 + uvs[b * 2 + 1] * 78.233 + 1000);
      return orderA - orderB;
    });
    
    // Sort indices for MOVEMENT order (different seed)
    const indicesMove = [...indices];
    indicesMove.sort((a, b) => {
      const orderA = seedRandom(uvs[a * 2] * 45.678 + uvs[a * 2 + 1] * 123.456 + 2000);
      const orderB = seedRandom(uvs[b * 2] * 45.678 + uvs[b * 2 + 1] * 123.456 + 2000);
      return orderA - orderB;
    });
    
    // Store both orders
    for (let i = 0; i < count; i++) {
      particleOrderVisibility[indicesVis[i]] = i / count;
      particleOrderMovement[indicesMove[i]] = i / count;
    }
  } else {
    // For other modes, use the same order for both (based on pattern)
    indices.sort((a, b) => {
      const orderA = getOrderValue(uvs[a * 2], uvs[a * 2 + 1], params.orderingMode, params.orderingScale);
      const orderB = getOrderValue(uvs[b * 2], uvs[b * 2 + 1], params.orderingMode, params.orderingScale);
      return orderA - orderB;
    });
    
    // Use same order for both visibility and movement
    for (let i = 0; i < count; i++) {
      particleOrderVisibility[indices[i]] = i / count;
      particleOrderMovement[indices[i]] = i / count;
    }
  }
  
  geometry.attributes.aParticleOrderVisibility.needsUpdate = true;
  geometry.attributes.aParticleOrderMovement.needsUpdate = true;
}