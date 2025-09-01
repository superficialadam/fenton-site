// neue-fixed.js — Fixed version with proper particle rendering
import * as THREE from 'three';

const CELLS_URL = './public/cells.bin';

const canvas = document.getElementById('bg-splats');
const progressEl = document.getElementById('progress');
const progressValEl = document.getElementById('progressVal');
const statsEl = document.getElementById('stats');

let renderer, scene, camera, points, uniforms, clock;

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
  renderer.setClearColor(0x000022, 1);

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

  points = makePoints(data);
  scene.add(points);

  uniforms = points.material.uniforms;
  uniforms.uPlane.value.copy(planeSizeAtZ0());

  // Add axes helper for debugging
  const axesHelper = new THREE.AxesHelper(5);
  scene.add(axesHelper);

  // Expose for DevTools
  window.points = points;

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

function makePoints({ count, wCells, hCells, uvs, colors }) {
  const geom = new THREE.BufferGeometry();
  
  // Create position buffer (initially at origin, will be updated in shader)
  const positions = new Float32Array(count * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  // UV attribute
  geom.setAttribute('aUV', new THREE.BufferAttribute(uvs, 2));

  // Random start positions (sphere)
  const aStart = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 2.5 * Math.cbrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    aStart[i * 3 + 0] = r * Math.sin(ph) * Math.cos(th);
    aStart[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    aStart[i * 3 + 2] = r * Math.cos(ph);
  }
  geom.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3));

  // Color attribute
  geom.setAttribute('aColor', new THREE.Uint8BufferAttribute(colors, 4, true));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0.5 },
    uPlane: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: wCells / hCells },
    uPointSize: { value: 30.0 }  // Bigger for visibility
  };

  const vertexShader = `
    attribute vec2 aUV;
    attribute vec3 aStart;
    attribute vec4 aColor;
    
    varying vec4 vColor;

    uniform float uTime;
    uniform float uProgress;
    uniform float uPointSize;
    uniform float uImgAspect;
    uniform vec2 uPlane;

    vec3 n3(vec3 p){
      return vec3(
        sin(p.x + 1.7) + sin(p.y*1.3 + 2.1) + sin(p.z*0.7 + 4.2),
        sin(p.x*0.9 + 3.4) + sin(p.y + 5.2) + sin(p.z*1.1 + 1.3),
        sin(p.x*1.2 + 2.7) + sin(p.y*0.8 + 6.1) + sin(p.z + 0.9)
      ) * 0.33;
    }

    void main(){
      vColor = aColor;

      // Map UV to image plane
      float planeAspect = uPlane.x / uPlane.y;
      vec2 p = aUV * 2.0 - 1.0;
      
      if (planeAspect > uImgAspect) {
        p.x *= (uImgAspect / planeAspect);
      } else {
        p.y *= (planeAspect / uImgAspect);
      }
      
      vec3 target = vec3(p * 0.5 * uPlane, 0.0);

      // Animated start position
      vec3 start = aStart;
      vec3 wobble = n3(start * 0.9 + uTime * 0.6);
      vec3 turbulent = start + wobble * 1.2;

      // Interpolate between start and target
      float t = smoothstep(0.0, 1.0, uProgress);
      vec3 finalPos = mix(turbulent, target, t);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
      gl_PointSize = uPointSize;
    }
  `;

  const fragmentShader = `
    varying vec4 vColor;
    
    void main(){
      vec2 pc = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(pc, pc);
      float alpha = 1.0 - smoothstep(0.7, 1.0, r2);
      
      if (alpha < 0.01) discard;
      
      gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geom, material);
  
  console.log(`Points created: ${count} particles`);
  console.log('First 5 colors:', Array.from(colors.slice(0, 20)));
  
  return points;
}