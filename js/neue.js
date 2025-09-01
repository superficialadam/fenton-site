// neue.js — clean, debuggable, no nested template strings
import * as THREE from 'three';

const CELLS_URL = './public/cells.bin'; // adjust if needed

const canvas = document.getElementById('bg-splats');
const progressEl = document.getElementById('progress');
const progressValEl = document.getElementById('progressVal');
const statsEl = document.getElementById('stats');

// ---- DEBUG SWITCHES ----
const DEBUG_SOLID_COLOR = false; // true → white squares
const DEBUG_HARD_DISCS = false; // true → hard disc mask
const DEBUG_BIGGER_POINTS = true;  // larger points for visibility
const DEBUG_FRAME_HELPER = true;  // show green frame of image plane

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
  renderer.setClearColor(0x222244, 1); // Lighter blue background to see dark particles

  // Log WebGL capabilities
  const gl = renderer.getContext();
  const maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  console.log('WebGL Point Size Range:', maxPointSize);

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
    if (statsEl) statsEl.textContent = `cells: ${data.count} | grid: ${data.wCells}×${data.hCells} | block: ${data.block}`;
    console.log('first 16 color bytes:', Array.from(data.colors.slice(0, 16)));
  } catch (e) {
    console.warn('cells.bin failed to load; using fallback.', e);
    if (statsEl) statsEl.textContent = 'cells.bin missing → fallback cloud';
    data = fallbackCells();
  }

  points = makePoints(data);
  scene.add(points);

  uniforms = points.userData.uniforms;
  uniforms.uPlane.value.copy(planeSizeAtZ0());

  // Expose for DevTools
  window.points = points;

  // Add a simple cube to verify rendering is working
  const testCube = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  testCube.position.set(2, 2, 0);
  scene.add(testCube);
  window.testCube = testCube;

  // Optional frame helper (z=0)
  if (DEBUG_FRAME_HELPER) {
    const frame = makeFrameHelper(uniforms.uPlane.value, data.wCells / data.hCells);
    scene.add(frame);
    window.frame = frame;
  }

  // Slider hookup
  const setProg = (v) => {
    const t = Math.max(0, Math.min(1, Number(v)));
    uniforms.uProgress.value = t;
    if (progressValEl) progressValEl.textContent = t.toFixed(3);
  };
  if (progressEl) {
    progressEl.addEventListener('input', e => setProg(e.target.value));
    setProg(0.5); // Start at 0.5 to see particles in transition
  } else {
    uniforms.uProgress.value = 0.5; // no HUD? pick a visible default
  }

  // Animate
  clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
  });

  // Resize
  window.addEventListener('resize', onResize);
  console.log('Init complete.');
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (uniforms) uniforms.uPlane.value.copy(planeSizeAtZ0());
}

// ---- Helpers ----
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
  const count = 2000, wCells = 100, hCells = 50, block = 4;
  const uvs = new Float32Array(count * 2);
  const colors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    uvs[i * 2 + 0] = Math.random();
    uvs[i * 2 + 1] = Math.random();
    colors[i * 4 + 0] = 255;
    colors[i * 4 + 1] = 255;
    colors[i * 4 + 2] = 255;
    colors[i * 4 + 3] = 255;
  }
  return { count, wCells, hCells, block, uvs, colors };
}

function makePoints({ count, wCells, hCells, uvs, colors }) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('aUV', new THREE.BufferAttribute(uvs, 2));

  // random start positions (sphere)
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

  // CRITICAL: Add position attribute (required by THREE.Points)
  const positions = new Float32Array(count * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // color attribute (rename → aColor)
  const aColor = new Uint8Array(colors.length);
  aColor.set(colors);
  geom.setAttribute('aColor', new THREE.Uint8BufferAttribute(aColor, 4, true)); // normalized
  
  // Log some debug info
  console.log('Geometry attributes:', Object.keys(geom.attributes));
  console.log('Position buffer length:', positions.length);
  console.log('Color buffer sample:', Array.from(aColor.slice(0, 16)));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPlane: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: wCells / hCells },
    uPointSize: { value: DEBUG_BIGGER_POINTS ? 20.0 : 6.0 }
  };

  const vert = `
    attribute vec2 aUV;
    attribute vec3 aStart;
    attribute vec4 aColor;
    varying vec4 vColor;

    uniform float uTime, uProgress, uPointSize, uImgAspect;
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

      // map aUV → plane (z=0) with letterbox fit to viewport
      float planeAspect = uPlane.x / uPlane.y;
      vec2 p = aUV * 2.0 - 1.0;
      if (planeAspect > uImgAspect) {
        p.x *= (uImgAspect / planeAspect);
      } else {
        p.y *= (planeAspect / uImgAspect);
      }
      vec3 target = vec3(p * 0.5 * uPlane, 0.0);

      vec3 start = aStart;
      vec3 wobble = n3(start * 0.9 + uTime * 0.6);
      vec3 turbulent = start + wobble * 1.2;

      float t = smoothstep(0.0, 1.0, uProgress);
      vec3 finalPos = mix(turbulent, target, t);

      // Update the position attribute (used by THREE.js internally)
      gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
      gl_PointSize = uPointSize;
    }
  `;

  // choose fragment shader source explicitly (no nested template strings)
  let frag = '';
  if (DEBUG_SOLID_COLOR) {
    frag = `
      void main(){
        gl_FragColor = vec4(1.0);
      }
    `;
  } else if (DEBUG_HARD_DISCS) {
    frag = `
      varying vec4 vColor;
      void main(){
        vec2 pc = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(pc, pc);
        float m  = step(r2, 1.0);
        gl_FragColor = vec4(vColor.rgb, vColor.a * m);
      }
    `;
  } else {
    frag = `
      varying vec4 vColor;
      void main(){
        vec2 pc = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(pc, pc);
        float m  = 1.0 - smoothstep(0.80, 1.00, r2);
        gl_FragColor = vec4(vColor.rgb, vColor.a * m);
      }
    `;
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: !DEBUG_SOLID_COLOR,
    depthWrite: false,
    blending: THREE.NormalBlending
  });

  const pts = new THREE.Points(geom, mat);
  pts.userData = { uniforms };

  console.log(`Points ready: ${count} particles.`, { wCells, hCells });

  // expose material for DevTools
  window.mat = mat;

  return pts;
}

function makeFrameHelper(planeVec2, imgAspect) {
  const planeAspect = planeVec2.x / planeVec2.y;
  let w = planeVec2.x * 0.5, h = planeVec2.y * 0.5; // same 0.5 scale used in vertex
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
