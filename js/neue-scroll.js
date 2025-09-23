// neue-gui.js — With lil-gui controls and JSON config
import * as THREE from 'three';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

const SEQUENCE_URLS = [
  './public/seq/step1.bin',
  './public/seq/step2.bin',
  './public/seq/step3.bin',
  './public/seq/step4.bin',
  './public/seq/step5.bin'
];
const CONFIG_URL = './config.json'; // Default config file

const canvas = document.getElementById('bg-splats');
const statsEl = document.getElementById('stats');

// Fade transition system removed - using direct opacity control


// Default parameters
const params = {
  particleSizeMin: 0.01, // Random size min
  particleSizeMax: 0.09, // Random size max
  particleSizeTarget: 0.02, // Fixed size at target
  movePercentage: 1.0, // 0-1, percentage of particles that should move to target (start with step2 visible)
  sequenceIndex: 0, // 0-4, which sequence step to target (start with step2)
  turbulence1Amount: 3.23,
  turbulence1Speed: 0.6,
  turbulence1Scale: 0.9,
  turbulence1Evolution: 0.3, // Speed of moving through noise
  turbulence2Amount: 0.5,
  turbulence2Speed: 0.3,
  turbulence2Scale: 2.0,
  turbulence2Evolution: 1.2,
  softness: 0.2, // 0 = very soft, 1 = hard edge
  edgeFade: 0.3, // Controls fade range
  visiblePercentage: 1.0, // 0-1, percentage of particles that should be visible
  fadeSpeedMin: 20, // Min frames to fade (30 = 0.5 sec at 60fps)
  fadeSpeedMax: 30, // Max frames to fade (90 = 1.5 sec at 60fps)
  moveSpeedMin: 45, // Min frames to reach target position
  moveSpeedMax: 90, // Max frames to reach target position
  dragAmount: 0.05, // Amount of drag applied to particles
  dragSpeedMin: 30, // Min frames for drag catchup
  dragSpeedMax: 120, // Max frames for drag catchup
  backgroundColor: '#0a0a0a',
  blendMode: 'additive',
  depthWrite: false,
  showFrame: false,

  // Scroll camera controls
  cameraOffsetX: 0.0,
  cameraOffsetY: 0.0,
  cameraOffsetZ: 6.0,
  cameraFOV: 70,
  scrollMultiplier: 0.01, // Scroll multiplier

  // Texture plane controls
  textureScale: 1.11, // Scale of texture within plane
  textureOffsetX: -0.055, // X offset of texture
  textureOffsetY: -0.055, // Y offset of texture

  // Fade timing parameters
  holdFrames: 70, // Frames to hold particles at target before fading
  fadeFrames: 10, // Frames for fade in/out transitions
  scrollDamping: 0.11,

  // Section Y offsets
  section1_offset: 0.0, // Y offset for section 1 (step1)
  section2_offset: 0.0, // Y offset for section 2 (step2)
  section3_offset: -8.6, // Y offset for section 3 (step3)
  section4_offset: -7.2, // Y offset for section 4 (step4)
  section5_offset: -10.8, // Y offset for section 5 (step5)

  // Turbulent particles
  turbulentParticleCount: 400 // Number of always-turbulent particles
};

let renderer, scene, camera, particles, turbulentParticles, uniforms, turbulentUniforms, clock, gui, guiNeedsUpdate = false;
let texturePlanes = [];
let debugInfo;
let fadeTimer = 0; // Timer for delay before texture fade in
let startupTimer = 0; // Timer for startup sequence
let startupPhase = 0; // 0: waiting 4s, 1: dispersed, 2: done

// Sequence data storage
let sequenceData = []; // Array to store all loaded .bin data
let maxParticleCount = 0; // Max particles across all sequences

// Scroll tracking variables
let scrollY = 0;
let targetCameraY = 0;
let currentCameraY = 0;

init().catch(err => {
  console.error('Init error:', err);
  if (statsEl) statsEl.textContent = 'Init error (see console).';
});

async function init() {
  // Config loading removed - using init params in code


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
  camera = new THREE.PerspectiveCamera(params.cameraFOV, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(params.cameraOffsetX, params.cameraOffsetY, params.cameraOffsetZ);
  currentCameraY = params.cameraOffsetY;

  // Expose for DevTools
  Object.assign(window, { scene, camera, renderer });

  // Load all sequence files
  try {
    console.log('Loading sequence files...');
    for (let i = 0; i < SEQUENCE_URLS.length; i++) {
      const data = await loadCellsBin(SEQUENCE_URLS[i]);
      sequenceData[i] = data;
      maxParticleCount = Math.max(maxParticleCount, data.count);
      console.log(`Loaded ${SEQUENCE_URLS[i]}: ${data.count} particles`);
    }
    console.log(`All sequences loaded. Max particles: ${maxParticleCount}`);
    if (statsEl) statsEl.textContent = `sequences: ${sequenceData.length} | max particles: ${maxParticleCount}`;
  } catch (e) {
    console.warn('Sequence files failed to load; using fallback.', e);
    if (statsEl) statsEl.textContent = 'Using fallback particles';
    const fallbackData = fallbackCells();
    sequenceData = [fallbackData];
    maxParticleCount = fallbackData.count;
  }

  // Find max dimensions across all sequences for consistent viewport
  let maxWCells = 0, maxHCells = 0;
  for (const seq of sequenceData) {
    maxWCells = Math.max(maxWCells, seq.wCells);
    maxHCells = Math.max(maxHCells, seq.hCells);
  }

  // Create interpolated sequence data so every particle has a position in every sequence
  const interpolatedSequences = createInterpolatedSequenceData(sequenceData, maxParticleCount);

  // Replace original sequence data with interpolated data
  sequenceData = interpolatedSequences;

  // Create particle system with max capacity
  const initialData = createParticleBuffer(maxParticleCount, sequenceData[params.sequenceIndex]);
  // Override dimensions to use max values for consistent viewport
  initialData.wCells = maxWCells;
  initialData.hCells = maxHCells;

  particles = makeInstancedParticles(initialData);
  scene.add(particles);

  // Create turbulent particles
  turbulentParticles = makeTurbulentParticles(params.turbulentParticleCount);
  scene.add(turbulentParticles);

  // Store particle data for re-ordering
  window.particleData = initialData;
  window.sequenceData = sequenceData;

  uniforms = particles.material.uniforms;
  uniforms.uPlane.value.copy(planeSizeAtZ0());

  turbulentUniforms = turbulentParticles.material.uniforms;
  turbulentUniforms.uPlane.value.copy(planeSizeAtZ0());

  // Initialize sequence offset using configurable section offsets
  const sectionOffsets = [
    params.section1_offset,
    params.section2_offset,
    params.section3_offset,
    params.section4_offset,
    params.section5_offset
  ];
  uniforms.uSequenceOffset.value = sectionOffsets[params.sequenceIndex];

   // Initialize startup sequence: particles at first target (sequence 0) and visible
   params.sequenceIndex = 0; // Start at sequence 0
   params.movePercentage = 1.0;
   updateMovementTargets(particles.geometry);
   updateParticleTargets(particles.geometry, 1.0); // Visible

  // Frame helper
  const frame = makeFrameHelper(uniforms.uPlane.value, initialData.wCells / initialData.hCells);
  frame.visible = params.showFrame;
  scene.add(frame);
  window.frame = frame;


  // All sequences now have the same particle count, so no need for special switching

  // Initialize particle visibility and movement
  updateParticleTargets(particles.geometry);
  updateMovementTargets(particles.geometry);

  // Expose for DevTools
  window.particles = particles;

  // Setup scroll listener
  setupScrollListener();

  // Create debug info display - DISABLED
  // createDebugInfo();

  // Load textures and create planes
  await createTexturePlanes();

  // Animate
  clock = new THREE.Clock();
  let lastTime = 0;
  renderer.setAnimationLoop(() => {
    const currentTime = clock.getElapsedTime();
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    uniforms.uTime.value = currentTime;
    uniforms.uDeltaTime.value = deltaTime;

    turbulentUniforms.uTime.value = currentTime;
    turbulentUniforms.uDeltaTime.value = deltaTime;

    // Update scroll-based camera movement (only after startup)
    if (startupPhase === 2) {
      updateScrollCamera(deltaTime);
    }

    // Update camera Y position for particle tracking
    uniforms.uCameraY.value = camera.position.y;
    turbulentUniforms.uCameraY.value = camera.position.y;


    // Update particle visibility, movement, and drag
    updateParticleVisibility(particles.geometry, deltaTime);
    updateParticleMovement(particles.geometry, deltaTime);
    updateParticleDrag(particles.geometry, deltaTime);

    // Handle startup sequence
    startupTimer += deltaTime * 60; // Increment in frames

    if (startupPhase === 0 && startupTimer >= 240) { // 4 seconds = 240 frames at 60fps
      // Disperse particles
      updateParticleTargets(particles.geometry, 0.22); // 22% visible
      params.movePercentage = 0.0;
      updateMovementTargets(particles.geometry);
      startupPhase = 1;
    } else if (startupPhase === 1 && startupTimer >= 240 + 120) { // After additional 120 frames
      // Move to second target (sequence 1)
      params.sequenceIndex = 1;
      switchToSequence(1);
      params.movePercentage = 1.0;
      updateMovementTargets(particles.geometry);
      updateParticleTargets(particles.geometry, 1.0); // All visible
      startupPhase = 2;
    }

    // Update fade timer (only after startup)
    if (startupPhase === 2) {
      if (params.movePercentage >= 1.0) {
        fadeTimer += deltaTime * 60; // Increment in frames
      } else {
        fadeTimer = 0; // Reset when not at target
      }

      // Update particle visibility based on state
      if (params.movePercentage >= 1.0) {
        updateParticleTargets(particles.geometry, 1.0); // All particles visible when at target
      } else {
        updateParticleTargets(particles.geometry, 0.22); // 22% visible when dispersed
      }
    }

    // Opacity control with configurable delay
    let particleOpacity, textureOpacity;
    if (fadeTimer < params.holdFrames) {
      // Particles visible, texture invisible during delay
      particleOpacity = 1.0;
      textureOpacity = 0.0;
    } else {
      // Fade texture in and particles out over fadeFrames
      const fadeProgress = Math.min((fadeTimer - params.holdFrames) / params.fadeFrames, 1.0);
      particleOpacity = 1.0 - fadeProgress;
      textureOpacity = fadeProgress;
    }

    // Control global particle visibility via uVisiblePercentage
    if (fadeTimer >= params.holdFrames + params.fadeFrames) {
      uniforms.uVisiblePercentage.value = 0.0; // All particles invisible
    } else if (fadeTimer >= params.holdFrames) {
      uniforms.uVisiblePercentage.value = particleOpacity; // Fade visible particles
    } else {
      uniforms.uVisiblePercentage.value = 1.0; // Full visibility for visible particles
    }

    // Apply texture opacity
    if (texturePlanes[params.sequenceIndex]) {
      texturePlanes[params.sequenceIndex].material.opacity = textureOpacity;
    }

    // Update turbulent particles (they stay at default values)
    updateParticleVisibility(turbulentParticles.geometry, deltaTime);
    updateParticleMovement(turbulentParticles.geometry, deltaTime);
    updateParticleDrag(turbulentParticles.geometry, deltaTime);

    renderer.render(scene, camera);
  });

  // Resize
  window.addEventListener('resize', onResize);
  console.log('Init complete. Particles:', initialData.count);
}

// Setup scroll listener
function setupScrollListener() {
   const updateScroll = () => {
     scrollY = window.scrollY;
     // Inverted scroll: negative scroll value moves camera up
     targetCameraY = params.cameraOffsetY - (scrollY * 0.0086);

     // Update scroll-based transitions (only after startup)
     if (startupPhase === 2) {
       updateScrollTransitions();
     }

   };

   window.addEventListener('scroll', updateScroll, { passive: true });
   // Don't initialize scroll here, let startup handle initial state
}

// Scroll transition state tracking
let currentScrollState = null;
let disperseStartTime = null; // Track when particles started dispersing

// Scroll-based transition system
function updateScrollTransitions() {
  // Get section elements
  const heroSection = document.getElementById('hero');
  const section2 = document.getElementById('section-2');
  const section3 = document.getElementById('section-3');
  const section4 = document.getElementById('section-4');

  if (!heroSection || !section2 || !section3 || !section4) {
    console.warn('Some sections not found for scroll transitions');
    return;
  }

  // Get section positions
  const heroRect = heroSection.getBoundingClientRect();
  const section2Rect = section2.getBoundingClientRect();
  const section3Rect = section3.getBoundingClientRect();
  const section4Rect = section4.getBoundingClientRect();

  const viewportHeight = window.innerHeight;
  const enterThreshold = viewportHeight * 0.35; // 35% down from top
  const leaveThreshold = viewportHeight * 0.65; // 65% down from top

  let newState = null;

  // Proper transition states with timing consideration
  // Each section is 100vh, so we need:
  // - "in-section" when section is centered in viewport
  // - "leaving-section" when 65% past section (disperse starts)
  // - "between-sections" when fully between (safe to switch targets)
  // - "entering-section" when 35% into next section (form new target)

  // Calculate section scroll percentage based on journey through viewport
  const getSectionPercent = (rect) => {
    // 0% = section.top just touches bottom of viewport (rect.top = viewportHeight)
    // 100% = section.bottom just touches top of viewport (rect.bottom = 0)
    // Total journey = viewportHeight + rect.height

    const totalJourney = viewportHeight + rect.height;
    const traveledDistance = viewportHeight - rect.top;
    const percent = (traveledDistance / totalJourney) * 100;

    return Math.max(0, Math.min(100, percent));
  };

  const heroPercent = getSectionPercent(heroRect);
  const sec2Percent = getSectionPercent(section2Rect);
  const sec3Percent = getSectionPercent(section3Rect);
  const sec4Percent = getSectionPercent(section4Rect);

  // DEAD SIMPLE LOGIC: 40-60% window for each section
  // If a section is 40-60%, it's THE target. Otherwise NO target (dispersed).

  newState = 'dispersed'; // Default: no target

  // Check each section individually - only ONE can be active
  if (heroPercent >= 40 && heroPercent <= 60) {
    newState = 'in-hero'; // Hero is THE target
  } else if (sec2Percent >= 40 && sec2Percent <= 60) {
    newState = 'in-section2'; // Section2 is THE target
  } else if (sec3Percent >= 40 && sec3Percent <= 60) {
    newState = 'in-section3'; // Section3 is THE target
  } else if (sec4Percent >= 40 && sec4Percent <= 60) {
    newState = 'in-section4'; // Section4 is THE target
  }
  // If no section is 40-60%, newState stays 'dispersed'

  // Debug EVERY scroll event to see what's happening
  console.log(`SCROLL DEBUG:`);
  console.log(`  ScrollY: ${window.scrollY}`);
  console.log(`  PERCENTAGES: Hero=${heroPercent.toFixed(1)}% Sec2=${sec2Percent.toFixed(1)}% Sec3=${sec3Percent.toFixed(1)}% Sec4=${sec4Percent.toFixed(1)}%`);
  console.log(`  40-60% CHECK: Hero=${heroPercent >= 40 && heroPercent <= 60} Sec2=${sec2Percent >= 40 && sec2Percent <= 60} Sec3=${sec3Percent >= 40 && sec3Percent <= 60} Sec4=${sec4Percent >= 40 && sec4Percent <= 60}`);
  console.log(`  Calculated state: ${newState}`);

  // Show what target I believe should be active
  let expectedTarget = "DISPERSED";
  if (heroPercent >= 40 && heroPercent <= 60) expectedTarget = "STEP2 (HERO section)";
  else if (sec2Percent >= 40 && sec2Percent <= 60) expectedTarget = "STEP3 (SECTION-2)";
  else if (sec3Percent >= 40 && sec3Percent <= 60) expectedTarget = "STEP4 (SECTION-3)";
  else if (sec4Percent >= 40 && sec4Percent <= 60) expectedTarget = "STEP5 (SECTION-4)";

  console.log(`  EXPECTED TARGET: ${expectedTarget}`);
  console.log(`  CURRENT SEQUENCE: ${params.sequenceIndex} (should be: ${expectedTarget.includes('STEP2') ? '1' : expectedTarget.includes('STEP3') ? '2' : expectedTarget.includes('STEP4') ? '3' : expectedTarget.includes('STEP5') ? '4' : 'no change'})`);

  // Debug log state changes
  if (newState !== currentScrollState) {
    console.log(`*** SCROLL STATE CHANGED: ${currentScrollState} → ${newState} ***`);

    currentScrollState = newState;

    switch (newState) {
      // ACTIVE TARGET STATES - particles form at this section's target
      case 'in-hero':
        updateParticleParams(1.0, 1.0, 1); // HERO → step2 (but step2 is index 1 in array) - NO GUARD, ALWAYS UPDATE
        break;
      case 'in-section2':
        updateParticleParams(1.0, 1.0, 2); // SECTION-2 → step3 (but step3 is index 2 in array) - NO GUARD, ALWAYS UPDATE
        break;
      case 'in-section3':
        updateParticleParams(1.0, 1.0, 3); // SECTION-3 → step4 (but step4 is index 3 in array) - NO GUARD, ALWAYS UPDATE
        break;
      case 'in-section4':
        updateParticleParams(1.0, 1.0, 4); // SECTION-4 → step5 (but step5 is index 4 in array) - NO GUARD, ALWAYS UPDATE
        break;

      // DISPERSED STATE - no target, particles scattered
      case 'dispersed':
        updateParticleParams(0.0, 1.0, null); // Keep dispersed, no sequence change
        break;
    }
  }
}



// Helper function to update particle parameters
function updateParticleParams(movePercentage, visiblePercentage, sequenceIndex) {
  // Handle movePercentage changes
  if (movePercentage !== null) {
    params.movePercentage = movePercentage;
    if (uniforms) uniforms.uMovePercentage.value = movePercentage;
    if (particles) updateMovementTargets(particles.geometry);
  }

  if (visiblePercentage !== null) {
    params.visiblePercentage = visiblePercentage;
    if (uniforms) uniforms.uVisiblePercentage.value = visiblePercentage;
    if (particles) updateParticleTargets(particles.geometry, visiblePercentage);
  }

  // Handle sequence switching - NO TIMING GUARDS, JUST SWITCH IMMEDIATELY
  if (sequenceIndex !== null && sequenceIndex !== params.sequenceIndex) {
    console.log(`Switching sequence from ${params.sequenceIndex} to ${sequenceIndex} IMMEDIATELY`);
    params.sequenceIndex = sequenceIndex;
    switchToSequence(sequenceIndex);
  }
}

// Create debug info display
function createDebugInfo() {
  debugInfo = document.createElement('div');
  debugInfo.style.position = 'fixed';
  debugInfo.style.top = '10px';
  debugInfo.style.left = '10px';
  debugInfo.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  debugInfo.style.color = 'white';
  debugInfo.style.padding = '10px';
  debugInfo.style.fontFamily = 'monospace';
  debugInfo.style.fontSize = '14px';
  debugInfo.style.zIndex = '1000';
  document.body.appendChild(debugInfo);
}

// Update debug info
function updateDebugInfo() {
  if (debugInfo) {
    // Get section info for debug
    const heroSection = document.getElementById('hero');
    const section2 = document.getElementById('section-2');
    const section3 = document.getElementById('section-3');
    const section4 = document.getElementById('section-4');

    let sectionInfo = '';
    if (heroSection && section2 && section3 && section4) {
      const heroRect = heroSection.getBoundingClientRect();
      const section2Rect = section2.getBoundingClientRect();
      const section3Rect = section3.getBoundingClientRect();
      const section4Rect = section4.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Calculate section scroll percentage based on journey through viewport
      const getSectionPercent = (rect) => {
        // 0% = section.top just touches bottom of viewport (rect.top = viewportHeight)
        // 100% = section.bottom just touches top of viewport (rect.bottom = 0)
        // Total journey = viewportHeight + rect.height

        const totalJourney = viewportHeight + rect.height;
        const traveledDistance = viewportHeight - rect.top;
        const percent = (traveledDistance / totalJourney) * 100;

        return Math.max(0, Math.min(100, percent));
      };

      const heroPercent = getSectionPercent(heroRect);
      const sec2Percent = getSectionPercent(section2Rect);
      const sec3Percent = getSectionPercent(section3Rect);
      const sec4Percent = getSectionPercent(section4Rect);

      // Determine which section we're primarily in
      let currentSection = 'none';
      if (heroRect.top >= -heroRect.height && heroRect.top <= 0) currentSection = 'HERO';
      else if (section2Rect.top >= -section2Rect.height && section2Rect.top <= 0) currentSection = 'SECTION-2';
      else if (section3Rect.top >= -section3Rect.height && section3Rect.top <= 0) currentSection = 'SECTION-3';
      else if (section4Rect.top >= -section4Rect.height && section4Rect.top <= 0) currentSection = 'SECTION-4';

      sectionInfo = `<br>
        <strong>SECTION SCROLL PROGRESS:</strong><br>
        Hero: ${heroPercent.toFixed(1)}% (top=${heroRect.top.toFixed(0)})<br>
        Sec2: ${sec2Percent.toFixed(1)}% (top=${section2Rect.top.toFixed(0)})<br>
        Sec3: ${sec3Percent.toFixed(1)}% (top=${section3Rect.top.toFixed(0)})<br>
        Sec4: ${sec4Percent.toFixed(1)}% (top=${section4Rect.top.toFixed(0)})<br>
        <strong>State: ${currentScrollState || 'none'}</strong><br>
        Move%: ${params.movePercentage.toFixed(2)} Vis%: ${params.visiblePercentage.toFixed(2)} Seq: ${params.sequenceIndex}
      `;
    } else {
      sectionInfo = `<br>SECTIONS NOT FOUND`;
    }

    debugInfo.innerHTML = `
      <strong>SCROLL DEBUG</strong><br>
      Scroll Y: ${scrollY}<br>
      Camera Y: ${camera.position.y.toFixed(2)}${sectionInfo}
    `;
  }
}

// Update texture planes to always be canvas-wide
function updateTexturePlanePositions() {
  if (texturePlanes.length === 0) return;

  // Calculate canvas-wide dimensions at Z=0 using proper frustum calculation
  const planeSize = planeSizeAtZ0();

  texturePlanes.forEach((plane, index) => {
    // Get texture aspect ratio
    const texture = plane.material.map;
    const textureAspect = texture.image ? texture.image.width / texture.image.height : 1.0;
    const canvasAspect = planeSize.x / planeSize.y;

    // Calculate plane dimensions to maintain texture aspect ratio
    let planeWidth, planeHeight;
    if (textureAspect > canvasAspect) {
      // Texture is wider than canvas - fit width, scale height proportionally
      planeWidth = planeSize.x;
      planeHeight = planeSize.x / textureAspect;
    } else {
      // Texture is taller than canvas - fit height, scale width proportionally
      planeHeight = planeSize.y;
      planeWidth = planeSize.y * textureAspect;
    }

    // Recreate geometry with proper aspect ratio
    plane.geometry.dispose();
    plane.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

    // Position vertically using configurable section offsets
    const sectionOffsets = [
      params.section1_offset,
      params.section2_offset,
      params.section3_offset,
      params.section4_offset,
      params.section5_offset
    ];
    plane.position.y = sectionOffsets[index];
  });

  // Update sequence offset for current sequence
  if (uniforms && uniforms.uSequenceOffset) {
    const sectionOffsets = [
      params.section1_offset,
      params.section2_offset,
      params.section3_offset,
      params.section4_offset,
      params.section5_offset
    ];
    uniforms.uSequenceOffset.value = sectionOffsets[params.sequenceIndex];
  }
}

// Update texture controls
function updateTextureControls() {
  if (texturePlanes.length === 0) return;

  texturePlanes.forEach(plane => {
    if (plane.material && plane.material.map) {
      const texture = plane.material.map;
      texture.repeat.set(params.textureScale, params.textureScale);
      texture.offset.set(params.textureOffsetX, params.textureOffsetY);
      texture.needsUpdate = true;
    }
  });
}

// Fade transition functions removed - using direct opacity control

// Fade transition update removed - using direct opacity control

// Transition trigger removed - using direct opacity control

// Create texture planes with additive blending
async function createTexturePlanes() {
  const textureLoader = new THREE.TextureLoader();

  // Define texture configurations
  const textureFiles = [
    './public/new/section1.png',
    './public/new/section2.png',
    './public/new/section3.png',
    './public/new/section4.png',
    './public/new/section5.png'
  ];

  // Load all textures
  const texturePromises = textureFiles.map(file =>
    new Promise((resolve, reject) => {
      textureLoader.load(file, resolve, undefined, reject);
    })
  );

  try {
    const textures = await Promise.all(texturePromises);

    // Create simple planes for each texture
    textureFiles.forEach((file, index) => {
      const texture = textures[index];

      // Create plane geometry with proper aspect ratio
      const planeSize = planeSizeAtZ0();
      const textureAspect = texture.image ? texture.image.width / texture.image.height : 1.0;
      const canvasAspect = planeSize.x / planeSize.y;

      // Calculate plane dimensions to maintain texture aspect ratio
      let planeWidth, planeHeight;
      if (textureAspect > canvasAspect) {
        // Texture is wider than canvas - fit width, scale height proportionally
        planeWidth = planeSize.x;
        planeHeight = planeSize.x / textureAspect;
      } else {
        // Texture is taller than canvas - fit height, scale width proportionally
        planeHeight = planeSize.y;
        planeWidth = planeSize.y * textureAspect;
      }

      const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

      // Create simple material with texture (start with opacity 0)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.0,
        color: 0xffffff
      });

      // Apply texture controls
      texture.repeat.set(params.textureScale, params.textureScale);
      texture.offset.set(params.textureOffsetX, params.textureOffsetY);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;

      // Create mesh
      const plane = new THREE.Mesh(geometry, material);

      // Position at Z=0 with initial Y position using configurable section offsets
      const sectionOffsets = [
        params.section1_offset,
        params.section2_offset,
        params.section3_offset,
        params.section4_offset,
        params.section5_offset
      ];
      plane.position.set(0, sectionOffsets[index], 0);

      // Add to scene and store reference
      scene.add(plane);
      texturePlanes.push(plane);
    });

    console.log(`Created ${texturePlanes.length} simple texture planes`);
  } catch (error) {
    console.error('Error loading textures:', error);
  }
}

// Update camera position with damping
function updateScrollCamera(deltaTime) {
  // Damped camera movement
  const dampingFactor = params.scrollDamping; // Use the GUI controllable damping
  currentCameraY += (targetCameraY - currentCameraY) * dampingFactor * deltaTime * 60; // Assuming 60fps

  camera.position.y = currentCameraY;

  // Update debug info
  updateDebugInfo();
}



function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (uniforms) uniforms.uPlane.value.copy(planeSizeAtZ0());
  if (turbulentUniforms) turbulentUniforms.uPlane.value.copy(planeSizeAtZ0());

  // Update texture plane scaling for new window size
  updateTexturePlanePositions();
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

function createInterpolatedSequenceData(sequenceData, maxCount) {
  // Create interpolated positions for all particles across all sequences
  const interpolatedSequences = [];

  for (let seqIndex = 0; seqIndex < sequenceData.length; seqIndex++) {
    const sequence = sequenceData[seqIndex];
    const { count: originalCount, wCells, hCells, uvs: originalUvs, colors: originalColors } = sequence;

    // Create arrays for max particle count
    const uvs = new Float32Array(maxCount * 2);
    const colors = new Uint8Array(maxCount * 4);

    // Copy original particles - make all white
    for (let i = 0; i < originalCount; i++) {
      uvs[i * 2] = originalUvs[i * 2];
      uvs[i * 2 + 1] = originalUvs[i * 2 + 1];
      colors[i * 4] = 255; // White R
      colors[i * 4 + 1] = 255; // White G
      colors[i * 4 + 2] = 255; // White B
      colors[i * 4 + 3] = originalColors[i * 4 + 3]; // Keep alpha
    }

    // For extra particles, sample from existing white/text positions
    if (originalCount < maxCount) {
      const extraCount = maxCount - originalCount;

      // Seeded random function for deterministic sampling
      const seedRandom = (seed) => {
        let x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
      };

      for (let i = 0; i < extraCount; i++) {
        const particleIndex = originalCount + i;

        // Use deterministic random to pick an existing particle position to copy
        const randomSeed = particleIndex * 123.456789;
        const sourceIndex = Math.floor(seedRandom(randomSeed) * originalCount);

        // Copy position from a random existing particle (white area)
        uvs[particleIndex * 2] = originalUvs[sourceIndex * 2];
        uvs[particleIndex * 2 + 1] = originalUvs[sourceIndex * 2 + 1];

        // Set to white
        colors[particleIndex * 4] = 255;
        colors[particleIndex * 4 + 1] = 255;
        colors[particleIndex * 4 + 2] = 255;
        colors[particleIndex * 4 + 3] = originalColors[sourceIndex * 4 + 3]; // Keep alpha
      }
    }

    interpolatedSequences[seqIndex] = {
      count: maxCount,
      originalCount: originalCount,
      wCells,
      hCells,
      uvs,
      colors
    };
  }

  return interpolatedSequences;
}

function createParticleBuffer(maxCount, activeSequence) {
  // Simple wrapper for backward compatibility
  return {
    count: maxCount,
    activeCount: activeSequence.originalCount || activeSequence.count,
    wCells: activeSequence.wCells,
    hCells: activeSequence.hCells,
    uvs: activeSequence.uvs,
    colors: activeSequence.colors
  };
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

  // Add separate target UV coordinates (initially same as instance UV)
  geometry.setAttribute('aTargetUV', new THREE.InstancedBufferAttribute(new Float32Array(uvs), 2));

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

  // Simple random ordering function
  const getOrderValue = (u, v) => {
    return seedRandom(u * 12.9898 + v * 78.233);
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

  // Drag system attributes
  // Previous camera position for each particle (starts at 0)
  const aPrevCameraY = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aPrevCameraY[i] = 0.0;
  }
  geometry.setAttribute('aPrevCameraY', new THREE.InstancedBufferAttribute(aPrevCameraY, 1));

  // Drag speed for each particle (deterministic based on index)
  const aDragSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = seedRandom(i * 123.789 + 67.890); // Different seed for drag
    const frames = params.dragSpeedMin + t * (params.dragSpeedMax - params.dragSpeedMin);
    aDragSpeed[i] = 1.0 / frames;
  }
  geometry.setAttribute('aDragSpeed', new THREE.InstancedBufferAttribute(aDragSpeed, 1));

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
    uDragAmount: { value: params.dragAmount },
    uDeltaTime: { value: 0 },
    uSequenceOffset: { value: 0 },
    uCameraY: { value: 0 }
  };

  const vertexShader = `
     attribute vec2 aInstanceUV;
     attribute vec2 aTargetUV;
     attribute vec3 aInstanceStart;
     attribute vec4 aInstanceColor;
     attribute float aOpacity;
     attribute float aProgress;
     attribute float aRandomSize;
     attribute float aPrevCameraY;
     attribute float aDragSpeed;

     varying vec4 vColor;
     varying vec2 vUv;
     varying float vOpacity;

     uniform float uTime;
     uniform float uImgAspect;
     uniform vec2 uPlane;
     uniform float uVisiblePercentage;
     uniform float uParticleSizeTarget;
    uniform float uTurbulence1Amount;
    uniform float uTurbulence1Speed;
    uniform float uTurbulence1Scale;
    uniform float uTurbulence1Evolution;
    uniform float uTurbulence2Amount;
    uniform float uTurbulence2Speed;
    uniform float uTurbulence2Scale;
    uniform float uTurbulence2Evolution;
    uniform float uDragAmount;
    uniform float uSequenceOffset;
    uniform float uCameraY;

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
       vOpacity = aOpacity * uVisiblePercentage;

       // Map target UV to image plane (for target position)
       float planeAspect = uPlane.x / uPlane.y;
       vec2 p = aTargetUV * 2.0 - 1.0;

       if (planeAspect > uImgAspect) {
         p.x *= (uImgAspect / planeAspect);
       } else {
         p.y *= (planeAspect / uImgAspect);
       }


       vec3 target = vec3(p * uPlane * 0.45, 0.0);

       // Offset target position based on sequence index to match texture plane positions
       target.y += uSequenceOffset;

      // Two layers of turbulence with evolution
      vec3 start = aInstanceStart;

      // First turbulence layer - evolves through noise space
      vec3 noiseCoord1 = start * uTurbulence1Scale + vec3(0.0, 0.0, uTime * uTurbulence1Evolution);
      vec3 wobble1 = n3(noiseCoord1 + uTime * uTurbulence1Speed) * uTurbulence1Amount;

      // Second turbulence layer - different scale and evolution
      vec3 noiseCoord2 = start * uTurbulence2Scale + vec3(0.0, 0.0, uTime * uTurbulence2Evolution);
      vec3 wobble2 = n3(noiseCoord2 * 1.7 + uTime * uTurbulence2Speed + 100.0) * uTurbulence2Amount;

      vec3 turbulent = start + wobble1 + wobble2;

      // Calculate dragged camera Y
      float draggedCameraY = mix(aPrevCameraY, uCameraY, uDragAmount);

      // Interpolate between turbulent and target positions FIRST
      vec3 instancePos = mix(turbulent, target, aProgress);

      // THEN apply camera Y influence to the interpolated position
      // When aProgress=0: particles follow camera Y movement (full influence)
      // When aProgress=1: particles ignore camera Y (no influence, stay at target)
      float cameraYInfluence = 1.0 - aProgress;
      instancePos.y += draggedCameraY * cameraYInfluence;

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

function makeTurbulentParticles(count) {
  // Create a single plane geometry that will be instanced
  const planeGeom = new THREE.PlaneGeometry(1, 1);

  // Create instanced buffer geometry
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = planeGeom.index;
  geometry.attributes.position = planeGeom.attributes.position;
  geometry.attributes.uv = planeGeom.attributes.uv;

  // Add instance attributes
  // Random UVs since they don't affect turbulent particles
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uvs[i * 2] = Math.random();
    uvs[i * 2 + 1] = Math.random();
  }
  geometry.setAttribute('aInstanceUV', new THREE.InstancedBufferAttribute(uvs, 2));

  // White colors
  const colors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    colors[i * 4] = 255; // White R
    colors[i * 4 + 1] = 255; // White G
    colors[i * 4 + 2] = 255; // White B
    colors[i * 4 + 3] = 255; // Full alpha
  }
  geometry.setAttribute('aInstanceColor', new THREE.InstancedBufferAttribute(colors, 4, true));

  // Add separate target UV coordinates (same as instance for turbulent)
  geometry.setAttribute('aTargetUV', new THREE.InstancedBufferAttribute(new Float32Array(uvs), 2));

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

  // Fade system attributes - always visible
  const aOpacity = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aOpacity[i] = 1.0;
  }
  geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));

  const aTargetOpacity = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aTargetOpacity[i] = 1.0;
  }
  geometry.setAttribute('aTargetOpacity', new THREE.InstancedBufferAttribute(aTargetOpacity, 1));

  // Fade speed (dummy)
  const aFadeSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aFadeSpeed[i] = 1.0;
  }
  geometry.setAttribute('aFadeSpeed', new THREE.InstancedBufferAttribute(aFadeSpeed, 1));

  // Movement system attributes - always at progress 0
  const aProgress = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aProgress[i] = 0.0; // Always turbulent
  }
  geometry.setAttribute('aProgress', new THREE.InstancedBufferAttribute(aProgress, 1));

  const aTargetProgress = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aTargetProgress[i] = 0.0; // Never move to target
  }
  geometry.setAttribute('aTargetProgress', new THREE.InstancedBufferAttribute(aTargetProgress, 1));

  // Move speed (dummy)
  const aMoveSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aMoveSpeed[i] = 1.0;
  }
  geometry.setAttribute('aMoveSpeed', new THREE.InstancedBufferAttribute(aMoveSpeed, 1));

  // Random particle sizes
  const aRandomSize = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    aRandomSize[i] = params.particleSizeMin + t * (params.particleSizeMax - params.particleSizeMin);
  }
  geometry.setAttribute('aRandomSize', new THREE.InstancedBufferAttribute(aRandomSize, 1));

  // Drag system attributes
  const aPrevCameraY = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aPrevCameraY[i] = 0.0;
  }
  geometry.setAttribute('aPrevCameraY', new THREE.InstancedBufferAttribute(aPrevCameraY, 1));

  const aDragSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    aDragSpeed[i] = 1.0;
  }
  geometry.setAttribute('aDragSpeed', new THREE.InstancedBufferAttribute(aDragSpeed, 1));

  // Particle order (dummy, since always visible and at progress 0)
  const particleOrderVisibility = new Float32Array(count);
  const particleOrderMovement = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    particleOrderVisibility[i] = 0.0;
    particleOrderMovement[i] = 0.0;
  }
  geometry.setAttribute('aParticleOrderVisibility', new THREE.InstancedBufferAttribute(particleOrderVisibility, 1));
  geometry.setAttribute('aParticleOrderMovement', new THREE.InstancedBufferAttribute(particleOrderMovement, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPlane: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: 1 }, // dummy
    uVisiblePercentage: { value: 1.0 }, // turbulent always visible
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
    uVisiblePercentage: { value: 1.0 }, // always visible
    uMovePercentage: { value: 0.0 }, // never move
    uDragAmount: { value: params.dragAmount },
    uDeltaTime: { value: 0 },
    uSequenceOffset: { value: 0 },
    uCameraY: { value: 0 }
  };

  const vertexShader = `
    attribute vec2 aInstanceUV;
    attribute vec2 aTargetUV;
    attribute vec3 aInstanceStart;
    attribute vec4 aInstanceColor;
    attribute float aOpacity;
    attribute float aProgress;
    attribute float aRandomSize;
    attribute float aPrevCameraY;
    attribute float aDragSpeed;

    varying vec4 vColor;
    varying vec2 vUv;
    varying float vOpacity;

     uniform float uTime;
     uniform float uImgAspect;
     uniform vec2 uPlane;
     uniform float uVisiblePercentage;
     uniform float uParticleSizeTarget;
    uniform float uTurbulence1Amount;
    uniform float uTurbulence1Speed;
    uniform float uTurbulence1Scale;
    uniform float uTurbulence1Evolution;
    uniform float uTurbulence2Amount;
    uniform float uTurbulence2Speed;
    uniform float uTurbulence2Scale;
    uniform float uTurbulence2Evolution;
    uniform float uDragAmount;
    uniform float uSequenceOffset;
    uniform float uCameraY;

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
       vOpacity = aOpacity * uVisiblePercentage;

      // Map target UV to image plane (for target position)
      float planeAspect = uPlane.x / uPlane.y;
      vec2 p = aTargetUV * 2.0 - 1.0;

      if (planeAspect > uImgAspect) {
        p.x *= (uImgAspect / planeAspect);
      } else {
        p.y *= (planeAspect / uImgAspect);
      }


      vec3 target = vec3(p * uPlane * 0.45, 0.0);

      // Offset target position based on sequence index to match texture plane positions
      target.y += uSequenceOffset;

      // Two layers of turbulence with evolution
      vec3 start = aInstanceStart;

      // First turbulence layer - evolves through noise space
      vec3 noiseCoord1 = start * uTurbulence1Scale + vec3(0.0, 0.0, uTime * uTurbulence1Evolution);
      vec3 wobble1 = n3(noiseCoord1 + uTime * uTurbulence1Speed) * uTurbulence1Amount;

      // Second turbulence layer - different scale and evolution
      vec3 noiseCoord2 = start * uTurbulence2Scale + vec3(0.0, 0.0, uTime * uTurbulence2Evolution);
      vec3 wobble2 = n3(noiseCoord2 * 1.7 + uTime * uTurbulence2Speed + 100.0) * uTurbulence2Amount;

      vec3 turbulent = start + wobble1 + wobble2;

      // Calculate dragged camera Y
      float draggedCameraY = mix(aPrevCameraY, uCameraY, uDragAmount);

      // Interpolate between turbulent and target positions FIRST
      vec3 instancePos = mix(turbulent, target, aProgress);

      // THEN apply camera Y influence to the interpolated position
      // When aProgress=0: particles follow camera Y movement (full influence)
      // When aProgress=1: particles ignore camera Y (no influence, stay at target)
      float cameraYInfluence = 1.0 - aProgress;
      instancePos.y += draggedCameraY * cameraYInfluence;

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

  console.log(`Turbulent particles created: ${count} instances`);

  return mesh;
}

// Switch to a different sequence without particle jumps
function switchToSequence(newIndex) {
  if (!sequenceData[newIndex] || !particles) return;

  const newSequence = sequenceData[newIndex];
  const geometry = particles.geometry;

  // Update target UVs for ALL particles (all sequences now have same particle count)
  const targetUVs = geometry.attributes.aTargetUV.array;

  // Update target UV coordinates for all particles
  for (let i = 0; i < maxParticleCount; i++) {
    targetUVs[i * 2] = newSequence.uvs[i * 2];
    targetUVs[i * 2 + 1] = newSequence.uvs[i * 2 + 1];
  }

  // Mark target UVs for update
  geometry.attributes.aTargetUV.needsUpdate = true;

  // Update window reference
  window.particleData = createParticleBuffer(maxParticleCount, newSequence);

  // Keep consistent aspect ratio using max dimensions (don't change on switch)
  // uniforms.uImgAspect.value remains the same for all sequences

  // Set sequence offset using configurable section offsets
  const sectionOffsets = [
    params.section1_offset,
    params.section2_offset,
    params.section3_offset,
    params.section4_offset,
    params.section5_offset
  ];
  uniforms.uSequenceOffset.value = sectionOffsets[newIndex];

  const originalCount = newSequence.originalCount || newSequence.count;
  console.log(`Switched to sequence ${newIndex}: ${originalCount} original particles, ${maxParticleCount} total particles`);
  console.log(`Sequence offset: ${sectionOffsets[newIndex]}`);
  console.log('All particles will smoothly transition to new targets based on movePercentage');
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
function updateParticleTargets(geometry, visiblePercentage) {
  const count = geometry.attributes.aTargetOpacity.count;
  const targetOpacity = geometry.attributes.aTargetOpacity.array;
  const particleOrderVisibility = geometry.attributes.aParticleOrderVisibility.array;

  // Set target opacity based on VISIBILITY particle order
  // Particles with order < visiblePercentage should be visible
  for (let i = 0; i < count; i++) {
    targetOpacity[i] = particleOrderVisibility[i] < visiblePercentage ? 1.0 : 0.0;
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

// Update drag speeds when parameters change (keeps deterministic ratio)
function updateDragSpeeds(geometry) {
  const count = geometry.attributes.aDragSpeed.count;
  const dragSpeed = geometry.attributes.aDragSpeed.array;

  // Seeded random function
  const seedRandom = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  for (let i = 0; i < count; i++) {
    // Use deterministic random based on particle index
    const t = seedRandom(i * 123.789 + 67.890);
    const frames = params.dragSpeedMin + t * (params.dragSpeedMax - params.dragSpeedMin);
    dragSpeed[i] = 1.0 / frames;
  }

  geometry.attributes.aDragSpeed.needsUpdate = true;
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

// Update particle drag every frame - makes each particle catch up to camera Y at different speeds
function updateParticleDrag(geometry, deltaTime) {
  const count = geometry.attributes.aPrevCameraY.count;
  const prevCameraY = geometry.attributes.aPrevCameraY.array;
  const dragSpeed = geometry.attributes.aDragSpeed.array;

  // Assuming 60 FPS for frame-based drag speed
  const frameMultiplier = deltaTime * 60;

  for (let i = 0; i < count; i++) {
    // Each particle catches up to the current camera Y at its own speed
    const diff = camera.position.y - prevCameraY[i];

    if (Math.abs(diff) > 0.001) {
      const step = dragSpeed[i] * frameMultiplier;

      if (diff > 0) {
        prevCameraY[i] = Math.min(prevCameraY[i] + step * Math.abs(diff), camera.position.y);
      } else {
        prevCameraY[i] = Math.max(prevCameraY[i] + step * diff, camera.position.y);
      }
    } else {
      prevCameraY[i] = camera.position.y; // Sync when very close
    }
  }

  geometry.attributes.aPrevCameraY.needsUpdate = true;
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

  // Random ordering with different seeds for visibility and movement
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

  geometry.attributes.aParticleOrderVisibility.needsUpdate = true;
  geometry.attributes.aParticleOrderMovement.needsUpdate = true;
}
