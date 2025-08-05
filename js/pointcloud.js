// js/pointcloud.js
class PointCloudScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('threejs-canvas'),
      alpha: true,
      antialias: true
    });

    this.pointCloud = null;
    this.particles = null;
    this.particleCount = 5000;

    this.init();
  }

  init() {
    // Setup renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Setup camera
    this.camera.position.z = 5;

    // Create point cloud
    this.createPointCloud();

    // Setup resize handler
    window.addEventListener('resize', () => this.onWindowResize());

    // Start render loop
    this.animate();
  }

  createPointCloud() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);

    // Create initial sphere formation
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Sphere distribution
      const radius = Math.random() * 2 + 1;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);

      // White particles
      colors[i3] = 1;
      colors[i3 + 1] = 1;
      colors[i3 + 2] = 1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });

    this.pointCloud = new THREE.Points(geometry, material);
    this.scene.add(this.pointCloud);

    // Store original positions for morphing
    this.originalPositions = positions.slice();
  }

  morphToShape(shapeType, progress) {
    const positions = this.pointCloud.geometry.attributes.position.array;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      let targetX, targetY, targetZ;

      switch (shapeType) {
        case 'cube':
          targetX = (Math.random() - 0.5) * 4;
          targetY = (Math.random() - 0.5) * 4;
          targetZ = (Math.random() - 0.5) * 4;
          break;

        case 'plane':
          targetX = (Math.random() - 0.5) * 6;
          targetY = (Math.random() - 0.5) * 6;
          targetZ = 0;
          break;

        case 'line':
          targetX = (i / this.particleCount) * 8 - 4;
          targetY = Math.sin(targetX) * 0.5;
          targetZ = 0;
          break;

        default: // sphere
          targetX = this.originalPositions[i3];
          targetY = this.originalPositions[i3 + 1];
          targetZ = this.originalPositions[i3 + 2];
      }

      // Interpolate between current and target position
      positions[i3] += (targetX - positions[i3]) * progress * 0.02;
      positions[i3 + 1] += (targetY - positions[i3 + 1]) * progress * 0.02;
      positions[i3 + 2] += (targetZ - positions[i3 + 2]) * progress * 0.02;
    }

    this.pointCloud.geometry.attributes.position.needsUpdate = true;
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Gentle rotation
    if (this.pointCloud) {
      this.pointCloud.rotation.y += 0.001;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
