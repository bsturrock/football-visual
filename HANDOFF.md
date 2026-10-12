# Handoff / project state

Start a new session from this repo by asking it to read this file and `README.md` first.

## Goal
A Three.js low-poly American football **visual + physics engine** for a CPU-vs-CPU sim.
The user is a "coach" and builds the play-calling/sim layer separately. The engine must
look like the reference images in `docs/reference/` (matte, flat-shaded, large facets,
blue Riverdale vs red Stonefield, broadcast sideline camera, scorebug HUD).
Tackles, catches and blocking must be **physics-driven**, not canned animations.

## Current state
- Engine: `src/engine/*`. See README for the API and events. The demo driver is `src/demo/DemoSim.js`; it is replaceable.
- Players are **generated in code** (no model files): `Body.js` resolves height/weight/archetype/seed into proportions,
  `PlayerModel.js` builds the boxy player (target: `docs/reference/target-model.png`) on the animation joints,
  `Uniforms.js` gives home/away/alt colours. Numbers and names are per-player canvas decals. See `plan.md`.
- Animation: procedural and physics-driven (`Animator.js`), rigid box segments per joint; foot planting uses each rig's leg lengths.
- `lineup.html` is the player preview / validation page. `?nosim` shows an empty field.
- The Meshy/Blender pipeline was removed (it's in git history before the "procedural players" commit).

- Side project: `characters/` (see `characters/README.md` and `characters/ARCHITECTURE.md`) is moving players to a
  Blender-authored base mesh (`characters/source/med-base-low-poly.glb`). Milestone 1 (clean + export + viewer) is done;
  the live game is unchanged until we pivot.

## Known issues / next steps
1. Hand-tuned animations for specific moves on top of the procedural base (stances, tackles, catches, throws).
2. Equipment variety (facemask styles, visors, sleeves) and uniform details (sleeve numbers, helmet logos, fonts).
3. Automated validation script for generated bodies (height, ground contact, symmetry, helmet size).
4. Stadium lighting pass to match the studio-matte look (flatter than the reference at distance).
5. Midfield logo is a rough placeholder (`Field.js` WOLF_OUTLINE). Real team logos (PNG/SVG) are wanted.
6. Optional: referee and coach figures built the same way as players.

## Environment notes
- SSH to GitHub is blocked from the sandbox. Use session-level GitHub authorization to push.
- Headless testing: Playwright + SwiftShader works but runs about 30× slower than real time.
