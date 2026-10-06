# TECHNOPHILIA: grow the tree

An interactive digital art installation. A single glowing seed in the dark cracks open and sends up
a stem; six independent technological branches leave it, left and right, and you *grow* them by
clicking nodes. No menus: the tree is the interface.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## How to use it

| Action | Result |
| --- | --- |
| Click the almond seed | The seed cracks, a shoot climbs out, the stem rises and the six buds open |
| Click / tap a glowing node | Energy travels from the seed through the circuitry, the branch grows, the camera follows, the title ignites, child nodes bloom |
| Click a *dim* grown node | Re-activate that branch (energy replays along its ancestry) |
| `Esc` / `Backspace` | Retract one level: energy flows back toward the root, camera pulls out |
| Click the seed glyph (bottom-left) / `Home` | Retract everything, the six primary branches return |
| Mouse wheel / pinch | Free zoom (anchored under the pointer); drag to pan |
| `F` / double-click empty space | Dive into the original tight close-up of the current branch; again to come back |
| Click a breadcrumb | Jump back to that level |
| `M` or the sound switch | Mute / unmute the synthesised sound design |
| `Tab` / `Enter` | Every node is a real button: fully keyboard navigable |

## Change the content (no engine changes)

Everything lives in [`src/data/tree.ts`](src/data/tree.ts). It is a plain nested array:

```ts
{
  title: 'QUANTUM',                 // ← the configurable SIXTH category
  style: 'quantum',                 // neural | mechanical | organic | chaotic | network | quantum
  palette: { a: '#8ff3ff', b: '#a07bff', accent: '#ff7ae6' },
  description: '…',
  children: [{ title: '…', description: '…', children: [ … ] }],
}
```

Add categories, children and grandchildren to any depth: the layout re-partitions the territory
automatically. Each category is also free to use any `style`.

## Architecture

```
src/data/tree.ts        content (data-driven)
src/engine/
  layout.ts             stem + side-band layout → guarantees the six branches can never overlap
  trunk.ts              per-style spine generation (hermite, PCB 45° routing, jagged, meander …)
  detail.ts             procedural circuitry that follows the spine (strands, dendrites, buses,
                        chips, tendrils, lattices, helices, orbital rings, LEDs, vias)
  BranchMesh.ts         one branch = ghost thread + GPU ribbon trace + instanced SDF components,
                        growth driven by a single uniform
  shaders.ts            all GLSL (energy front, trails, idle beads, SDF parts, seed, background)
  Fx.ts                 node markers, seed, reactive PCB background, particles, sparks, energy orb
  CameraRig.ts          damped cinematic camera, auto-framing, parallax, impact kick
  Overlay.ts            DOM labels/hit-areas (accessible buttons) with collision-aware placement
  AudioEngine.ts        Web Audio synth: hover, select, pulse, grow, impact, reverse + ambience
  Engine.ts             state machine, timelines (GSAP), render loop, post-processing, adaptivity
src/components/         thin React shell (HUD only – zero per-frame React work)
```

Rendering notes: ~36 draw calls with all six primaries open, <0.5 ms CPU per frame. Quality tiers
(`src/engine/config.ts`) lower DPR / bloom / particles / circuit density on phones, and an adaptive
monitor drops resolution if the frame rate sags. `prefers-reduced-motion` disables camera sway and
parallax and shortens the timelines. On portrait screens the tree narrows and stretches taller, and
labels simplify (only the current node's children are labelled).

## Tech

Next.js 16 · TypeScript · three.js (custom ShaderMaterial/GLSL, instancing) · `postprocessing`
(selective-ish mipmap bloom, vignette, grain, chromatic aberration) · GSAP · Web Audio API ·
Unbounded + Geist Mono.

Built with guidance from the installed agent skills in `.agents/skills`
(three.js fundamentals / shaders / post-processing / best-practices, GSAP, Vercel React practices).
