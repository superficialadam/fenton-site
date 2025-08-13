# Claude Prompt: Scroll-Driven Splat Transition System

## Brief

We already have a working single-splat prototype in **`splat.html`** + **`splatNoise.js`** (Three.js + Luma splats with custom shader hooks). We love the **look, parameters, and behavior** in `splatNoise.js` and we want to keep them intact. The goal is to build a **scroll-driven background system** for a Webflow homepage with **four 100vh sections**. Each section is bound to one specific Luma splat. As the user scrolls **into** a section, its splat transitions through: **IDLE → APPEARING → CLOUD → FORM** (fully formed at 0.40), holds FORM until 0.60, then disperses in reverse order as the section exits. At any time, only the active section’s splat should render — others must be hidden/removed from the scene to save performance.

---

## Critical, Unambiguous Instructions

1. **Start with the exact full content of my current `splatNoise.js`** as your implementation base for the new JS file. Do not re-invent or “improve” the shader logic, noise, matrices, or existing uniform names/semantics. Keep that code intact and adapt it minimally to support multiple preloaded splats, scroll mapping, and switching the active splat.
2. **Do not edit or overwrite** my existing `splat.html` or `splatNoise.js` files.
3. **Create exactly two new files**:
   - `splatScroll.html` — an HTML scaffold I can paste into Webflow’s custom code area.
   - `splatScroll.js` — a module that starts from the exact contents of `splatNoise.js`, then extends it to: preload 4 splats, map scroll→uniforms, and ensure only the active splat renders.
4. **No external libraries.** Use only browser APIs, Three.js, and `@lumaai/luma-web` via import maps.
5. **Performance rule:** Only one splat is added to the scene (or `visible=true`) at any time; all others must be removed from the scene (or `visible=false`) so **they do not render**. Blackening a splat is not enough — it must not draw.

---

## File: `splatScroll.html`

- Full-page `<canvas id="bg-splats">` fixed and behind content.
- Imports Three.js and Luma via unpkg.
- Declares four 100vh sections with IDs for scroll binding: `sec-1`, `sec-2`, `sec-3`, `sec-4`.
- Loads `splatScroll.js` as a module.

**Exact structure to output:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Splat Scroll</title>
  <style>
    html, body { margin:0; padding:0; height:100%; overflow-x:hidden; }
    canvas#bg-splats {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      background: black;
    }
    section { height: 100vh; }
  </style>
</head>
<body>
  <section id="sec-1"></section>
  <section id="sec-2"></section>
  <section id="sec-3"></section>
  <section id="sec-4"></section>

  <canvas id="bg-splats"></canvas>

  <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.157.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.157.0/examples/jsm/",
        "@lumaai/luma-web": "https://unpkg.com/@lumaai/luma-web@0.2.0/dist/library/luma-web.module.js"
      }
    }
  </script>
  <script type="module" src="./splatScroll.js"></script>
</body>
</html>
```

---

## File: `splatScroll.js` (must **start with the exact content of `splatNoise.js`**)

**Start your file by pasting the full current code from `splatNoise.js`, then adapt it** to:

- Handle **four** Luma splats with these sources (in order):
  1. <https://lumalabs.ai/capture/a7eb44c9-cba1-4fed-b0e2-26f6399549ba>
  2. <https://lumalabs.ai/capture/0180b1f3-d3ef-4020-820a-22a36d94cb52>
  3. <https://lumalabs.ai/capture/4f362242-ad43-4851-9b04-88adf71f24f5>
  4. <https://lumalabs.ai/capture/369f2055-ca06-498e-9c55-40110d332909>
- Set `semanticsMask = LumaSplatsSemantics.FOREGROUND` and `loadingAnimationEnabled=false` for each.
- **Preload** all four splats (`onLoad` promises). Render a black frame until all are ready; then warm up ~10 frames.
- Keep a single renderer, scene, camera, and RAF loop.
- Ensure **only the active section’s splat is in the scene** (or visible) each frame. Remove others so they do **not** render.
- Bind sections to splats in order: `#sec-1 → splat[0]`, `#sec-2 → splat[1]`, `#sec-3 → splat[2]`, `#sec-4 → splat[3]`.

### Scroll → State mapping (updated)

For each section, compute local normalized scroll `t ∈ [0,1]`:

- `t = 0` when the section top aligns with viewport top.
- `t = 0.5` at section center.
- `t = 1` when section bottom aligns with viewport top.

**Requirement:** At **t = 0.40** the splat is **fully formed**; it remains fully formed until **t = 0.60**, then disperses (reverse states) as `t → 1`.

Provide configurable **default breakpoints** as follows:

```js
const defaultBreakpoints = {
  idleEnd: 0.16,        // IDLE → APPEARING
  appearingEnd: 0.30,   // APPEARING → CLOUD
  formReach: 0.40,      // CLOUD → FORM complete
  formHoldEnd: 0.60     // end of FORM plateau
};
```

- For **0.00–0.16**: blend **IDLE → APPEARING**.
- **0.16–0.30**: blend **APPEARING → CLOUD**.
- **0.30–0.40**: blend **CLOUD → FORM** (must hit FORM exactly at 0.40).
- **0.40–0.60**: **hold FORM**.
- **0.60–0.70**: blend **FORM → CLOUD**
- **0.70–0.84**: blend **CLOUD → APPEARING**
- **0.84–1.00**: blend **APPEARING → IDLE**

### Uniforms (set **every frame**, even if constant)

```
u_progress
u_turbulenceStrength
u_turbulenceScale
u_noiseScale        // always 0.88
u_dispersionVolume
u_splatSize
u_splatOpacity
u_colorFade
u_blackSplatsPercent
u_saturation
u_brightness
u_influence
u_dragMin
u_dragMax
```

### State Presets
>
> Tween these targets per interval; **do not change shader logic**. Keep `u_noiseScale = 0.88` in **all** states.

**IDLE**

```js
u_progress: 0.10,
u_turbulenceStrength: 7.2,
u_turbulenceScale: 0.03,
u_noiseScale: 0.88,
u_dispersionVolume: 12.4,
u_splatSize: 0.1,
u_splatOpacity: 1.6,
u_colorFade: 0.10,
u_blackSplatsPercent: 1.00,
u_saturation: 0.00,
u_brightness: 1.18,
u_influence: 1.00,
u_dragMin: 0.1,
u_dragMax: 1.8
```

**APPEARING**

```js
u_progress: 0.30,
u_turbulenceStrength: 7.2,
u_turbulenceScale: 0.03,
u_noiseScale: 0.88,
u_dispersionVolume: 12.4,
u_splatSize: 0.1,
u_splatOpacity: 1.6,
u_colorFade: 0.10,
u_blackSplatsPercent: 0.99,
u_saturation: 0.00,
u_brightness: 1.18,
u_influence: 1.00,
u_dragMin: 0.1,
u_dragMax: 1.8
```

**CLOUD**

```js
u_progress: 0.55,
u_turbulenceStrength: 7.2,
u_turbulenceScale: 0.03,
u_noiseScale: 0.88,
u_dispersionVolume: 12.4,
u_splatSize: 0.1,
u_splatOpacity: 1.6,
u_colorFade: 0.10,
u_blackSplatsPercent: 0.66,
u_saturation: 0.00,
u_brightness: 1.18,
u_influence: 1.00,
u_dragMin: 0.1,
u_dragMax: 1.8
```

**FORM**

```js
u_progress: 1.00,
u_turbulenceStrength: 7.2,
u_turbulenceScale: 0.03,
u_noiseScale: 0.88,
u_dispersionVolume: 12.4,
u_splatSize: 0.1,
u_splatOpacity: 1.6,
u_colorFade: 0.00,
u_blackSplatsPercent: 0.00,
u_saturation: 1.00,
u_brightness: 1.18,
u_influence: 0.00,
u_dragMin: 0.1,
u_dragMax: 1.8
```

---

## Output Contract

Output **two files only**:

1. `splatScroll.html`
2. `splatScroll.js` (beginning with the exact current contents of `splatNoise.js`, then your extensions)

Do **not** modify or overwrite `splat.html` or `splatNoise.js`.
