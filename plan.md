# Procedural Football Player Generator (engine-built)

## Decision

The original plan built players in Blender from a Meshy master model. The boxy art
style made that unnecessary: every part of the target look is a box with a flat
colour, so players are now **generated in code inside the engine** at load time.

- No asset files, no export pipeline, no per-model cleanup.
- Every proportion is a number, so height / weight / build variation is exact and continuous.
- Body segments are attached rigidly to the animation skeleton: no skinning, no warped boxes, clean joints.
- Team colours are exact region colours; numbers and names are drawn per player.
- The same seed and inputs always produce the same player.

Visual reference: `docs/reference/target-model.png` (proportions taken from the
`med-boxy-3` Meshy model, which is reference only and not shipped).

## Goals (unchanged)

1. Consistent, believable proportions.
2. The simple, chunky, boxy low-poly look: large flat faces, sharp edges, flat colours.
3. Continuous variation in height, weight and body proportions.
4. One shared skeleton and animation system for every player.
5. Very low geometry and material cost.
6. Deterministic generation from a seed.

**Most important:** every player must look like a variation of the same character.

## Architecture

| File | Role |
|---|---|
| `src/engine/Body.js` | `resolveBody({ seed, position, heightIn, weightLb, archetype, overrides })` → 16 normalised proportions. Archetypes, position defaults, PRNG. |
| `src/engine/PlayerModel.js` | `createPlayerRig({ body, kit, skin, number, name })` builds the boxy player on the joint hierarchy, one merged mesh per joint, plus number/name decals. `bodyDims()` exposes the measurements. |
| `src/engine/Uniforms.js` | `resolveKit(team, 'home' \| 'away' \| 'alt')` → region colours. |
| `src/engine/Animator.js` | Procedural, physics-driven animation on the shared joints. Uses each rig's own leg lengths for foot planting. |
| `lineup.html` | Preview / validation page: test lineup, seed variation, custom sliders, live poses. |

### Body parameters

`height_cm` / `weight_kg` come from the sim as `heightIn` / `weightLb` (rolled from the
position if missing). Normalised proportions (1.0 = 6'1", 225 lb reference):
`shoulder_width, chest_width, chest_depth, waist_width, waist_depth, hip_width,
torso_length, leg_length, arm_length, neck_thickness, upper_arm_thickness,
forearm_thickness, thigh_thickness, calf_thickness, glute_size, abdomen_size`.

- **Height**: legs take more of the extra height than the torso; the helmet scales only very slightly; hands/feet modestly.
- **Weight**: per-region response to the BMI ratio (bellies and waists grow fastest, shoulders slowest). Not a uniform scale.
- **Archetypes**: compact, lean_athletic, balanced_athletic, strong_athletic, power, massive. Each has typical size distributions and regional biases. Position → archetype by default; `archetype: null` disables presets.
- **Variation**: correlated traits (upper mass, lower mass, core, leg-vs-torso length) plus small independent noise, clamped to ±2.5σ.
- **Reproducibility**: the resolved body is a plain object (`player.body`); passing it back as `body` rebuilds the player without re-running the random logic.

## Phases

**Phase 1 — Reference and analysis** ✅
Meshy models analysed; decided on code generation. Proportions measured from `med-boxy-3`.

**Phase 2 — Basic proportion controls** ✅
Height, shoulder width, torso thickness, arm and leg thickness working; visual check against the target.

**Phase 3 — Full body parameterisation and archetypes** ✅ (first pass)
All 16 parameters, six archetypes, position defaults. Needs tuning by eye over time.

**Phase 4 — Skeleton and animation compatibility** ✅ (procedural)
Shared joint hierarchy; per-rig leg lengths for foot planting. Checked idle, run, sprint, backpedal, shuffle, stances, block in `lineup.html`, and in-game.
Next: hand-tuned animations for specific moves (see below).

**Phase 5 — Deterministic generation** ✅
Seeded PRNG, stored resolved bodies, placeholder names from the seed.

**Phase 6 — UI** ✅ (browser instead of Blender)
`lineup.html` sliders: position, height, weight, seed, uniform, pose, camera; randomize / reset.

**Phase 7 — Validation** (partly)
Done: six-player test lineup and same-size seed lineup render correctly; in-game check.
To add: automated checks (height accuracy, ground contact, symmetry, helmet size, segment counts) as a script.

## Next steps

1. **Animation fine-tuning**: keep code-driven physics as the base, add hand-tuned poses/clips for specific moves (stances, tackles, catches, throws). If clips are authored externally, add a Mixamo-named skeleton export of the same joints.
2. **Equipment variety**: facemask styles, visors, sleeves, arm bands, glove/cleat colours as seeded options.
3. **Uniform details**: sleeve/shoulder numbers, helmet logos, real fonts.
4. **Tuning**: proportions per archetype by eye against real rosters; shoulder pads vs body width at extremes.
5. **Automated validation** script (see Phase 7).
6. **Performance**: ~17 meshes + 2 decals per player. If needed, merge static parts further or instance by body.
