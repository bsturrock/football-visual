# Character system — Milestone 0 inventory

Governing docs: `docs/character_system/` (01_ARCHITECTURE, 02_IMPLEMENTATION_ROADMAP, 03_CLAUDE_CODE_HANDOFF).
They supersede `plan.md`, `characters/ARCHITECTURE.md` and the Meshy/Blender skinned pipeline in `characters/`.

## Decisions recorded with the user
| Topic | Decision |
|---|---|
| Fidelity reference for Milestone 2 | The **new** Meshy medium-player GLB (to be supplied), not `target-model.png` |
| Face visibility | Visible **through the facemask** on the field; the new body GLB will include a face |
| Helmet | New Meshy helmet GLB (to be supplied), geometry unchanged. Approved material changes: per-team recolour, texture downsizing, flat shading |
| Language | Plain JS ES modules (repo has no build step); the TS types in the docs become JSDoc |
| `characters/` retirement | Keep until Milestone 2 passes; decide then |

## Project setup (observed)
- No `package.json`, no bundler. Static files + import map in `index.html` / `lineup.html`.
- Three.js **r180** vendored in `vendor/three/` (`three.module.js`, `three.core.js`), addons: `GLTFLoader`, `OrbitControls`, `SkeletonUtils`, `BufferGeometryUtils`.
- Run: `python3 -m http.server 8000`. Headless check: Playwright + SwiftShader (`?capture` keeps the drawing buffer).
- Smoke test (this milestone): main page loads, 22 players spawn, no JS errors (only the Google Fonts request fails offline).

## Coordinates and units (observed)
- World: **1 unit = 1 yard**, Y up. X along the field, Z across (+Z = camera sideline). Facing = `atan2(dx, dz)`.
- Player rig: faces **+Z**, **+X is the player's left**, origin at the feet.
- Meshy/glTF assets: metres, Y up, front +Z (old base was confirmed this way). Conversion: × 1.0936 m→yd. Must be re-verified per new GLB.

## Simulation → render boundary (observed)
- `Player.js` owns state (pos, vel, facing, fall/tilt, balance, intents). Each frame (`Player.js` ~L575):
  `rig.root.position ← (pos.x, anim.lift, pos.y)`, `rig.yaw.rotation.y ← facing`, `rig.tilt.quaternion ← fall/lean`.
- `Animator.js` writes `rotation` on 17 joints from physical state (no clips), and solves pelvis height from `rig.leg` lengths.
- The renderer never decides outcomes. Physics uses a disc radius from weight (`Player.js` L49), independent of mesh size.

## The current player visual — the contract a replacement must honour
`createPlayerRig({ body, kit, skin, number, name })` in `src/engine/PlayerModel.js` returns:

| Field | Used by |
|---|---|
| `root`, `tilt`, `yaw` | `Player.js` placement / facing / falls |
| `bones` (17: `pelvis, spine, chest, neck, head, shL, elL, handL, shR, elR, handR, hipL, knL, ankL, hipR, knR, ankR`) | `Animator.js` (rotations, IK), `Player.js` hand positions, `Ball.js` (ball in `handR`), `Stadium.js`, `lineup.html` |
| `leg { HIP_Y, THIGH, SHIN, FOOT_H }` | `Animator.js` foot planting |
| `scale` | `Engine.js` catch reach |
| `dims` | `lineup.html` readout |
| `meshes`, `decals` | `bakeRig()` (bench players in `Stadium.js`), `disposeRig()` |

Joint conventions: rotation.x — hip −=flex forward, knee +=bend, shoulder −=raise forward, elbow −=bend, spine +=lean forward. Rest pose is **arms down**.

Doc hierarchy name → existing joint: PelvisPivot→`pelvis`, SpinePivot→`spine`/`chest`, NeckPivot→`neck`, HeadPivot→`head`,
Left/RightShoulder→`shL/shR`, Elbow→`elL/elR`, Wrist→`handL/handR`, Hip→`hipL/hipR`, Knee→`knL/knR`, Ankle→`ankL/ankR`.
**Plan: keep the existing names** (Animator, Ball, Engine depend on them) and document the mapping.

Other existing pieces that already match the new architecture:
- `Body.js`: seeded (mulberry32), position→archetype (6 archetypes), height/weight → 16 regional proportions, resolved body is persistable. Covers most of Milestone 4.
- `Uniforms.js`: per-team region colours (jersey, trim, pants, stripes, socks, helmet, stripe, mask, gloves, cleats).
- Rendering: one shared `MeshStandardMaterial` (vertex colours, `flatShading`), one merged mesh per joint (~17 meshes + 2 decal planes per player).
- `lineup.html`: the six-player test lineup (same sizes as the roadmap's Milestone 4 gate), seed variation, poses, cameras.

## Meshy inputs
| File | Status |
|---|---|
| New medium player GLB (with face, no helmet) | **awaiting upload** |
| New helmet GLB | **awaiting upload** |
| `characters/source/med-base-low-poly.glb` | superseded: helmet fused, no head, 1,230 tris, 533 islands |
| `characters/source/helmet.glb` | superseded: 408 tris, 221 islands, 2 × 4K textures |

## Minimal-change integration plan
1. **M1** — `tools/inspect/` inspector (Node or browser, using the vendored `GLTFLoader`) → `analysis/meshy_analysis.json`, editable `analysis/landmarks.json` (unknowns flagged), orthographic front/side/¾ renders. Originals copied verbatim to `assets/meshy/source/`.
2. **M2** — new geometry builder (tapered prisms, wedges, faceted head) driven by measured landmarks, assembled on the **existing joint hierarchy**; comparison viewer (Meshy vs procedural, same ortho camera, overlay/wireframe).
3. **M3–M5** — reuse `Animator` for pose tests; extend `Body.js` for faces/hair; portrait camera.
4. **M6** — helmet GLB cloned per player, parented to `head` via a measured `helmetOffset`; recolour via region materials.
5. **M7** — swap `createPlayerRig` internals behind the same return contract above, so `Player`, `Animator`, `Ball`, `Engine`, `Stadium` are untouched. Old builder kept as a fallback until profiling passes.

## Risks noted now
- Face visible through the mask means the helmet must be open at the front; check its cavity, don't assume.
- Two GLBs authored separately may differ in scale/axes; fitting uses a rigid transform only.
- Helmet texture recolouring depends on how cleanly Meshy painted the colour regions.
- Draw calls rise with a separate helmet + face meshes (≈20+ per player); measure in M7.
