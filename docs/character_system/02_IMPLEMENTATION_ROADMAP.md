# Implementation Roadmap and Acceptance Gates

This plan is for Claude Code working in an **existing Three.js football simulation**. Do **not** replace the game's existing architecture or implement every phase at once.

## Milestone 0 — Project reconnaissance
**Work:** Inspect current package/framework, asset loading, animation, simulation-to-render transforms, camera system, and existing player objects. Inventory exact Meshy GLB inputs and export variants. Document coordinate convention and dependency versions.

**Output:** `docs/character_system_inventory.md` with a minimal-change integration plan.

**Gate:** Existing game still runs. Developer can name the real paths and exact assets; no invented files.

## Milestone 1 — Meshy GLB inspector
**Work:** Load the original medium T-pose using `GLTFLoader` (or an offline glTF parser). Report mesh node names, local/world transforms, bounds, triangles, materials, mesh islands where feasible, and apparent bilateral symmetry. Preserve the original. Capture orthographic front, side, and three-quarter views. Add a landmark annotation mechanism if automated segmentation cannot distinguish body parts.

**Outputs:** `analysis/meshy_analysis.json`, `analysis/landmarks.json`, renders/screenshots, documented ambiguities.

**Gate:** Measured values come from real GLB vertices/transforms. No guessed measurements presented as facts.

## Milestone 2 — Reconstruct ONE medium character
**Work:** Implement reusable custom flat-faced shapes (tapered prism, wedge, faceted box/head), assemble the medium T-pose using measurements. Make an isolated comparison viewer: side-by-side Meshy and procedural, same scale and orthographic camera, wireframe, opacity overlay, zoom/presets.

**Output:** `createMediumPlayer()` and comparison viewer.

**Gate (critical go/no-go):** Silhouettes, overall proportions, body-part transitions, and flat planes sufficiently match at gameplay distance **and** front/side/three-quarter. Refine here before adding features. If precise parts fail, retain their exact source GLBs instead.

## Milestone 3 — Pivots and motion
**Work:** Put shapes in anatomically located joint groups. Add idle, run, crouch, block and tackle pose tests. Ensure elbow/knee/hip pivots track altered length. Add small overlapping caps/joins where required without destroying boxy style.

**Output:** `FootballCharacterRig` API and pose-test viewer.

**Gate:** No major gaps, flipped axes, floating feet, or clipping during test poses. Animation controls not hardcoded for one size.

## Milestone 4 — Continuous body generation
**Work:** Add height, weight, torso length/depth, shoulder/waist widths, arm/thigh/calf thickness. Create position-informed default ranges, deterministic seeded variation, bound checks and persistent resolved appearance JSON.

**Output:** `createFootballPlayer(appearance)` and interactive parameter panel.

**Gate:** A six-player lineup on ONE world-scale ground plane:

| Position | Height | Weight |
| --- | --- | --- |
| RB | 5'8" | 195 lb |
| WR | 6'1" | 195 lb |
| QB | 6'4" | 225 lb |
| LB | 6'2" | 245 lb |
| DE | 6'5" | 270 lb |
| OT | 6'6" | 325 lb |

Also render three identically sized linebackers with different seeds to show controlled variation. No absurd helmet/head inflation.

## Milestone 5 — Faces and portraits
**Work:** Add parametric face/head shape, modular hair/eyebrows/beards and color palette. Reuse saved identity information for player card portraits; optionally higher-detail portrait-only head. Add a fixed portrait camera and lighting setup.

**Output:** `createFace(identity)`, portrait grid, deterministic export or render function.

**Gate:** 50 identities show noticeable variety, remain stylistically coherent, and remain stable across reload.

## Milestone 6 — Exact equipment integration
**Work:** Import helmet and facemask GLBs unchanged where exact visuals matter, assign mount offsets, manage separable visor assets, and check head clearance through a range of bodies. If native facemask geometry is developed, compare against exact original before replacing.

**Output:** Asset registry, attachment API, visor toggle, equipment test scene.

**Gate:** Meshy helmet looks identical in isolation and after mounting except for rigid transform/material changes explicitly approved; no facial penetration in normal poses.

## Milestone 7 — Simulation integration + profiling
**Work:** Replace only the player visual layer in the existing Three.js game. Map simulated position/heading/animation state to player rigs; honor team colors; test 22 active players and sideline extras. Instrument FPS, frame duration, draw calls, triangles, shadow cost and character update time.

**Output:** Integration PR, performance report, documented fallback.

**Gate:** No gameplay outcome changes; consistent visual scale; acceptable performance on intended hardware.

## Milestone 8 — Production hardening
**Work:** Document asset versions and seed stability, save compatibility, runtime cached geometry/materials, LOD strategy, unit/integration tests and regression comparison screenshots.

**Gate:** A save reproduces the same appearance and equipment on subsequent launches. The original Meshy data remains retained for provenance/revisions.

## Rules for every milestone
1. Inspect current repo rather than assuming folder names or libraries.
2. Keep existing working gameplay functional.
3. Preserve imported Meshy originals; do not overwrite or quietly approximate them.
4. Record observed versus inferred measurements.
5. Build minimal validation tools alongside production code.
6. Pause after each acceptance gate for user review.
7. Document why a component remains exact GLB versus procedural geometry.
8. Never claim Meshy face, helmet or topology is watertight without checking it.
