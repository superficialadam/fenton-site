# Current State - December 19, 2024, 10:15 AM

## System Overview

This is a sophisticated Luma Splats visualization system built with Three.js that provides real-time control over Gaussian splat rendering with advanced turbulence effects, color manipulation, and drag-based influence systems.

## Core Functionality

### 1. **Luma Splats Integration**
- Uses `@lumaai/luma-web` library for Gaussian splat rendering
- Loads splats from Luma capture URL: `https://lumalabs.ai/capture/d80d4876-cf71-4b8a-8b5b-49ffac44cd4a`
- Background removal using `LumaSplatsSemantics.FOREGROUND`
- Custom shader hooks for advanced effects

### 2. **Turbulence System**
- **Curl Noise**: Advanced swirling patterns instead of random noise
- **Noise Scale**: 0-5 range for controlling detail/frequency of swirls
- **Dispersion Volume**: 0.1-20.0 range for controlling spread distance
- **Turbulence Strength**: 0.1-15.0 overall effect multiplier
- **Dispersion**: 0-100% slider controlling how scattered particles are

### 3. **Color Control System**
- **Saturation**: 0-3 range (0=grayscale, 1=original, 3=oversaturated)
- **Brightness**: 0-3 range (0=black, 1=original, 3=overbright)
- **Fade to Black**: 0-100% global darkening effect
- **Black Splats %**: 0-100% selective black splat patterns
- RGB↔HSV conversion for proper color space manipulation

### 4. **Drag-Based Influence System**
- **Influence**: 0-100% global multiplier for all effects
- **Drag Min/Max**: 0.1-3.0 range creating per-splat responsiveness variation
- Each splat gets individual drag value for natural variation
- Smooth scaling without choppy transitions
- Black controls remain independent of influence system

### 5. **Visual Controls**
- **Splat Size**: 0.1-5.0 multiplier (currently non-functional due to Luma API limitations)
- **Splat Opacity**: 0.0-2.0 transparency control
- Real-time UI with instant feedback
- All parameters show current values in labels

### 6. **Technical Features**
- Deterministic per-splat randomization using position-based seeds
- Smooth quintic easing for transitions
- Black background with transparent renderer setup
- OrbitControls for camera manipulation
- Console API for programmatic control

## File Structure

```
js/
├── splatNoise.js          # Main application file
├── loaders/
│   └── PCDLoader.js       # Point cloud loader (unused)
├── main.js                # Alternative main (unused)
├── pointcloud.js          # Point cloud system (unused)
└── splatMain.js           # Alternative splat main (unused)

assets/
├── terrain.pcd            # Point cloud data (unused)
├── testTexture.png        # Texture asset (unused)
└── Zaghetto.pcd          # Point cloud data (unused)

css/
└── style.css             # Styling

dist/
└── ff-pointcloud.min.js  # Minified build (unused)

index.html                # Main HTML entry point
splat.html               # Splat-specific HTML entry point
package.json             # Dependencies
```

## Console API

All controls are accessible via `window.splatControls`:

```javascript
// Turbulence Controls
splatControls.setTurbulence(strength, scale)
splatControls.setNoiseScale(0-5)
splatControls.setDispersionVolume(0.1-20.0)
splatControls.setDispersion(0-100)

// Color Controls
splatControls.setSaturation(0.0-3.0)
splatControls.setBrightness(0.0-3.0)
splatControls.setColorFade(0.0-1.0)
splatControls.setBlackSplatsPercent(0.0-1.0)

// Influence System
splatControls.setInfluence(0.0-1.0)
splatControls.setDragMin(0.1-3.0)
splatControls.setDragMax(0.1-3.0)

// Visual Controls
splatControls.setSplatSize(0.1-5.0)      // Non-functional
splatControls.setSplatOpacity(0.0-2.0)
```

## Webflow Integration Guide

### Method 1: Direct Integration (Recommended)

1. **Upload Assets to Webflow**:
   ```
   Upload js/splatNoise.js to Webflow Assets
   Get the CDN URL (e.g., https://assets.website-files.com/[id]/js/splatNoise.js)
   ```

2. **Add to Webflow Page**:
   ```html
   <!-- In Page Settings > Custom Code > Head Code -->
   <script type="importmap">
   {
     "imports": {
       "three": "https://unpkg.com/three@0.157.0/build/three.module.js",
       "three/addons/": "https://unpkg.com/three@0.157.0/examples/jsm/",
       "@lumaai/luma-web": "https://unpkg.com/@lumaai/luma-web@0.2.0/dist/library/luma-web.module.js"
     }
   }
   </script>
   ```

   ```html
   <!-- In Page Settings > Custom Code > Body Code (Footer) -->
   <canvas id="splat-canvas"></canvas>
   <script type="module" src="[YOUR_WEBFLOW_CDN_URL]/splatNoise.js"></script>
   ```

3. **Canvas Styling**:
   ```css
   /* Add to Page Settings > Custom Code > Head Code */
   <style>
   #splat-canvas {
     position: fixed;
     top: 0;
     left: 0;
     width: 100vw;
     height: 100vh;
     z-index: -1; /* Behind content */
     pointer-events: none; /* Allow clicks through */
   }
   </style>
   ```

### Method 2: Embedded Component

1. **Create Custom HTML Embed**:
   ```html
   <div id="splat-container" style="width: 100%; height: 400px; position: relative;">
     <canvas id="splat-canvas"></canvas>
   </div>

   <script type="importmap">
   {
     "imports": {
       "three": "https://unpkg.com/three@0.157.0/build/three.module.js",
       "three/addons/": "https://unpkg.com/three@0.157.0/examples/jsm/",
       "@lumaai/luma-web": "https://unpkg.com/@lumaai/luma-web@0.2.0/dist/library/luma-web.module.js"
     }
   }
   </script>

   <script type="module">
   // Paste entire splatNoise.js content here
   // Modify canvas selector to: document.querySelector('#splat-canvas')
   </script>
   ```

### Method 3: External Hosting

1. **Host on CDN** (Netlify, Vercel, etc.):
   ```
   Upload entire project to hosting service
   Get public URL
   ```

2. **Embed in Webflow**:
   ```html
   <iframe 
     src="https://your-hosted-url.com/splat.html" 
     width="100%" 
     height="400px" 
     frameborder="0">
   </iframe>
   ```

## Customization Options

### UI Controls Removal
To hide UI controls for production:
```javascript
// Comment out or remove this line in splatNoise.js:
// createUIControls();
```

### Parameter Presets
Set default values by modifying `animationParams`:
```javascript
const animationParams = {
  progress: 0.5,           // 50% dispersed
  turbulenceStrength: 2.0, // Higher turbulence
  saturation: 0.5,         // Desaturated
  influence: 0.8,          // 80% influence
  // ... other parameters
};
```

### Performance Optimization
```javascript
// Disable Three.js integration for better performance
let splat = new LumaSplatsThree({
  source: 'https://lumalabs.ai/capture/d80d4876-cf71-4b8a-8b5b-49ffac44cd4a',
  loadingAnimationEnabled: false,
  enableThreeShaderIntegration: false  // Add this line
});
```

## Known Issues

1. **Splat Size Control**: `getSplatScale` shader hook not working - may require different approach or Luma API update
2. **Mobile Performance**: High splat count may impact mobile devices
3. **CORS**: Some hosting environments may require CORS headers for Three.js modules

## Dependencies

- **Three.js**: ^0.157.0
- **@lumaai/luma-web**: ^0.2.0
- Modern browser with WebGL2 support
- ES6 modules support

## Browser Compatibility

- Chrome 80+
- Firefox 78+
- Safari 14+
- Edge 80+

WebGL2 and ES6 modules required for full functionality.