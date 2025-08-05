// js/main.js
let pointCloudScene;

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Three.js scene
  pointCloudScene = new PointCloudScene();

  // Register GSAP ScrollTrigger
  gsap.registerPlugin(ScrollTrigger);

  // Setup scroll-triggered animations
  setupScrollAnimations();
});

function setupScrollAnimations() {
  // Section 1: Default sphere
  ScrollTrigger.create({
    trigger: ".hero",
    start: "top bottom",
    end: "bottom top",
    onUpdate: (self) => {
      pointCloudScene.morphToShape('sphere', self.progress);
    }
  });

  // Section 2: Morph to cube
  ScrollTrigger.create({
    trigger: ".section-2",
    start: "top bottom",
    end: "bottom top",
    onUpdate: (self) => {
      pointCloudScene.morphToShape('cube', self.progress);
    }
  });

  // Section 3: Morph to plane
  ScrollTrigger.create({
    trigger: ".section-3",
    start: "top bottom",
    end: "bottom top",
    onUpdate: (self) => {
      pointCloudScene.morphToShape('plane', self.progress);
    }
  });

  // Section 4: Morph to line
  ScrollTrigger.create({
    trigger: ".section-4",
    start: "top bottom",
    end: "bottom top",
    onUpdate: (self) => {
      pointCloudScene.morphToShape('line', self.progress);
    }
  });

  // Overall scene rotation based on scroll
  gsap.to(pointCloudScene.pointCloud?.rotation || {}, {
    y: Math.PI * 2,
    scrollTrigger: {
      trigger: "body",
      start: "top top",
      end: "bottom bottom",
      scrub: 1
    }
  });
}
