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
- Players: stylized GLB models (`assets/lineman_styl.glb`, `assets/wr_styl.glb`), loaded by
  `ModelLibrary.js`. Each player gets one draw call, with region colours baked per team/kit/skin into vertex colours.
- Animation: the procedural animator drives an invisible proxy skeleton (`PlayerModel.js`).
  `Retargeter` copies its world rotations onto the Mixamo bones (bind offsets are computed
  by aiming proxy limbs along the model's T-pose segments).
- Builds: OL/DL/TE/LB use the lineman model (TE/LB narrower). WR/RB/CB/S use the WR model. QB uses the WR model with the `qb` kit.
  Each player has random height and width multipliers.
- `?procedural` in the URL uses the old code-built players (fallback). `?nosim` shows an empty field.

## Model pipeline (Meshy → Mixamo → Blender)
1. Meshy: T-pose, triangles, about 3–5k triangles, solid region colours, GLB/FBX.
2. Mixamo auto-rig, no fingers, T-pose FBX with skin. Then a rigged GLB.
3. `pip install bpy==4.2.0`, then
   `python3 tools/blender/stylize.py assets/source/<name>-rigged.glb assets/<name>_styl.glb --kit line|skill|qb`.
   The script cuts clean colour bands on the limbs, makes a geometric stripe, resolves the facemask and face opening by geometry,
   and assigns matte named materials. Originals are kept in `assets/source/`.
4. Preview: `glbview.html?f=assets/<name>_styl.glb&styl=1` (add `&cam=head&zoom=0.55` for a head close-up).

## Known issues / next steps
1. Stadium lighting pass to match the studio-matte look (flatter than the reference at distance).
2. Retune stance and arm angles in `Animator.js` for the new model proportions (arms hang slightly
   wide, stances a bit stiff vs reference images 1/2/4).
3. Midfield logo is a rough placeholder (`Field.js` WOLF_OUTLINE). Real team logos (PNG/SVG) are wanted.
4. Minor model leftovers: WR facemask brim clip, lineman brow triangles, stripe narrows at hip.
5. Optional: referee and coach models (same Meshy → Mixamo → stylize pipeline).
6. Optional: GitHub Pages deploy workflow; Git LFS for `.glb` files.
7. Linebacker model was dropped (poor generation). Two base builds plus size variation cover all positions.

## Environment notes
- SSH to GitHub is blocked from the sandbox. Use session-level GitHub authorization to push.
- Headless testing: Playwright + SwiftShader works but runs about 30× slower than real time.
