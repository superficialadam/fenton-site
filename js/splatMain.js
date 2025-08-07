// js/main.js
import { WebGLRenderer, PerspectiveCamera, Scene } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LumaSplatsThree } from '@lumaai/luma-web';

let canvas = document.querySelector('canvas');

let renderer = new WebGLRenderer({
  canvas: canvas,
  antialias: false
});

renderer.setSize(window.innerWidth, window.innerHeight, false);

let scene = new Scene();

let camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2;

let controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

let splat = new LumaSplatsThree({
  source: 'https://lumalabs.ai/capture/d80d4876-cf71-4b8a-8b5b-49ffac44cd4a'
});
scene.add(splat);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
