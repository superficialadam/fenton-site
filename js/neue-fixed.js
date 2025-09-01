// neue-fixed.js — Using instanced planes for controllable particle size
import * as THREE from 'three';

const CELLS_URL = './public/cells.bin';

const canvas = document.getElementById('bg-splats');
const progressEl = document.getElementById('progress');
const progressValEl = document.getElementById('progressVal');
const statsEl = document.getElementById('stats');

// ---- DEBUG SWITCHES ----
const PARTICLE_SIZE = 0.25; // Controllable particle size (in world units)
const DEBUG_FRAME_HELPER = true;

let renderer, scene, camera, particles, uniforms, clock;

init().catch(err => {
  console.error('Init error:', err);
  if (statsEl) statsEl.textContent = 'Init error (see console).';
});

async function init() {
  // Renderer / Camera / Scene
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x111111, 1);

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

  // Optional frame helper
  if (DEBUG_FRAME_HELPER) {
    const frame = makeFrameHelper(uniforms.uPlane.value, data.wCells / data.hCells);
    scene.add(frame);
  }

  // Expose for DevTools
  window.particles = particles;

  // Slider hookup
  const setProg = (v) => {
    const t = Math.max(0, Math.min(1, Number(v)));
    uniforms.uProgress.value = t;
    if (progressValEl) progressValEl.textContent = t.toFixed(3);
  };
  if (progressEl) {
    progressEl.addEventListener('input', e => setProg(e.target.value));
    setProg(progressEl.value || 0.5);
  } else {
    uniforms.uProgress.value = 0.5;
  }

  // Animate
  clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
  });

  // Resize
  window.addEventListener('resize', onResize);
  console.log('Init complete. Particles:', data.count);
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
    uvs[i * 2 + 1] = dv.getFloat32(o, true); o += 4;
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
  const planeGeom = new THREE.PlaneGeometry(PARTICLE_SIZE, PARTICLE_SIZE);

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

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0.5 },
    uPlane: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: wCells / hCells },
    uParticleSize: { value: PARTICLE_SIZE }
  };

  const vertexShader = `
    attribute vec2 aInstanceUV;
    attribute vec3 aInstanceStart;
    attribute vec4 aInstanceColor;
    
    varying vec4 vColor;
    varying vec2 vUv;

    uniform float uTime;
    uniform float uProgress;
    uniform float uImgAspect;
    uniform vec2 uPlane;
    uniform float uParticleSize;

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

      // Map instance UV to image plane
      float planeAspect = uPlane.x / uPlane.y;
      vec2 p = aInstanceUV * 2.0 - 1.0;
      
      if (planeAspect > uImgAspect) {
        p.x *= (uImgAspect / planeAspect);
      } else {
        p.y *= (planeAspect / uImgAspect);
      }
      
      vec3 target = vec3(p * 0.5 * uPlane, 0.0);

      // Animated start position
      vec3 start = aInstanceStart;
      vec3 wobble = n3(start * 0.9 + uTime * 0.6);
      vec3 turbulent = start + wobble * 1.2;

      // Interpolate between start and target
      float t = smoothstep(0.0, 1.0, uProgress);
      vec3 instancePos = mix(turbulent, target, t);

      // Apply instance transform to vertex position
      vec3 transformed = position + instancePos;
      
      // Billboard the particle to face camera
      vec4 mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
      mvPosition.xyz += position * uParticleSize;
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    varying vec4 vColor;
    varying vec2 vUv;
    
    void main(){
      // Create circular particle
      vec2 center = vUv - 0.5;
      float dist = length(center) * 2.0;
      
      if (dist > 1.0) discard;
      
      // Soft edge
      float alpha = 1.0 - smoothstep(0.7, 1.0, dist);
      
      // Use opaque blending to prevent accumulation
      gl_FragColor = vec4(vColor.rgb * alpha, alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true, // Enable depth writing to prevent accumulation
    depthTest: true,
    blending: THREE.NormalBlending
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  console.log(`Instanced particles created: ${count} instances, size: ${PARTICLE_SIZE}`);

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
