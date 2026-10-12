# Blender Procedural Football Player Generator

## Project Objective

Build a procedural American football player body-generation system in Blender using Python (`bpy`).

I have a single medium-build, ultra-low-poly football player model generated using Meshy. This will serve as the master character model.

The system must generate different football player physiques by modifying the proportions of the original model, without generating new geometry from scratch or creating entirely separate character models.

The eventual goal is to generate an entire fictional football league with hundreds or thousands of unique-looking players.

**Priorities:**
1. Maintain consistent and believable anatomical proportions.
2. Preserve the extremely simple, chunky, boxy low-poly art style.
3. Support continuous variation in height, weight, and body proportions.
4. Maintain compatibility with a shared skeletal animation system.
5. Keep polygon counts and material complexity extremely low.
6. Support deterministic procedural generation.

---

## 1. Master Model Preparation

Start by examining the imported Meshy model.

Inspect:
- Mesh topology and triangle count
- Object structure and disconnected mesh islands
- Object origins and transforms
- Material assignments
- Symmetry
- Existing rigging, if any
- Joint topology
- Helmet, facemask, gloves, cleats, and shoulder pads
- Mesh deformation suitability

Do not assume the Meshy output has clean topology or properly separated components.

Clean the model where necessary.

Preserve large flat surfaces, sharp edges, and deliberately boxy shapes.

Use flat shading or appropriately configured hard normals. Avoid subdivision surfaces and smoothing that makes the geometry appear rounded.

Establish a consistent coordinate system, forward direction, ground plane, and human-scale measurement system.

Save the cleaned model as an immutable MASTER_BASE character.

All generated characters must derive from this master without modifying it.

---

## 2. Standardized Base Proportions

Treat the medium player as a neutral athletic male football player.

Baseline dimensions:

- Height: 6'1" (185.4 cm)
- Weight: 225 lb (102.1 kg)
- Build: Medium athletic
- Shoulder width: Medium
- Chest: Athletic
- Waist: Medium
- Arms: Athletic
- Legs: Athletic

These baseline measurements are representative metadata, not exact physical measurements inferred from the mesh.

Normalize the character so its full standing height, including helmet, corresponds to the baseline height.

Record the original dimensions and anatomical landmarks before applying any procedural modifications.

Establish landmarks for:
- Top of helmet
- Neck
- Left/right shoulders
- Elbows
- Wrists
- Hips
- Knees
- Ankles
- Foot soles

Use these landmarks to preserve consistent proportions during scaling.

---

## 3. Continuous Body Parameters

Implement these adjustable parameters:

### Overall Dimensions
- `height_cm`
- `weight_kg`

### Body Proportions
- `shoulder_width`
- `chest_width`
- `chest_depth`
- `waist_width`
- `waist_depth`
- `hip_width`
- `torso_length`
- `leg_length`
- `arm_length`
- `neck_thickness`

### Muscle / Mass Distribution
- `upper_arm_thickness`
- `forearm_thickness`
- `thigh_thickness`
- `calf_thickness`
- `glute_size`
- `abdomen_size`

Use normalized values for proportion parameters, with 1.0 representing the medium base character.

The system must support smooth transitions between body types, rather than choosing only between predefined model sizes.

Height and weight should be primary inputs that derive reasonable default proportions. Allow explicit overrides.

Do not treat weight as a uniform scale multiplier.

Weight should influence volume through multiple body regions, using configurable football-position-specific distributions.

These mappings should be tunable rather than presented as an exact biomechanical simulation.

---

## 4. Height Scaling

Do NOT simply scale the entire character uniformly.

Different heights should be achieved by modifying anatomical proportions, especially:

- Thigh length
- Shin length
- Torso length
- Upper arm length
- Forearm length

Maintain realistic and visually consistent proportions.

Helmet/head dimensions should not increase linearly with total height.

Hands and feet may vary modestly with body size.

When adjusting height:
- Keep the feet grounded.
- Preserve correct hip, knee, ankle, shoulder, elbow, and wrist positions.
- Update skeletal joint positions to match the modified body.
- Avoid stretching the knee and elbow deformation regions disproportionately.
- Keep the character symmetrical.

Suggested supported height range:

- Minimum: 5'7" (170 cm)
- Maximum: 6'9" (206 cm)

All generated characters should remain visually compatible with the original low-poly style.

---

## 5. Weight and Body Mass Scaling

Weight must modify character shape rather than uniformly enlarging the model.

For example:

A 6'5", 320 lb offensive lineman should have:
- Very broad shoulders
- Thick chest
- Wide waist and abdomen
- Large hips
- Thick upper arms and forearms
- Powerful thighs and calves
- Heavy, blocky overall silhouette

A 6'1", 195 lb receiver should have:
- Narrower shoulders
- Slim waist
- Leaner arms
- Leaner legs
- Athletic proportions
- Noticeably smaller overall body volume

A 6'2", 245 lb linebacker should have:
- Broad shoulders
- Thick chest
- Strong upper arms
- Moderate waist
- Powerful thighs
- Athletic taper from shoulders to waist

**Critical:** The helmet and head must not inflate when increasing weight.

Body mass modifications should be distributed across the torso, arms, hips, and legs.

Keep the mesh visually geometric and simple. Do not sculpt realistic muscle definition.

---

## 6. Position Archetype Presets

Create configurable presets for:

| Archetype | Typical use |
|---|---|
| Compact | RB, returner |
| Lean Athletic | WR, CB |
| Balanced Athletic | QB, S |
| Strong Athletic | LB, TE |
| Power | DE, FB, some DL |
| Massive | OT, OG, C, DT |

Each preset defines default ranges for body parameters.

Presets must be probabilistic distributions, not hardcoded body shapes.

Players of the same position should still look visibly different.

For example, two linebackers of similar height and weight should be able to have different shoulder widths, torso shapes, arm thicknesses, and leg proportions.

The user should also be able to generate characters without using a position preset.

---

## 7. Shared Skeleton and Animation Compatibility

This is a critical requirement.

All player variants must be compatible with the same core animation library.

Use a consistent humanoid skeleton with identical:
- Bone names
- Bone hierarchy
- Bone orientation conventions
- Joint semantics

Bone lengths and rest positions may vary between characters.

Character geometry and bone positions must remain aligned as body proportions change.

Prefer a shared canonical skeleton definition and generate proportion-adjusted skeleton instances from it.

Ensure animation compatibility for:
- Running
- Sprinting
- Backpedaling
- Lateral shuffling
- Three-point stance
- Blocking
- Tackling
- Jumping
- Catching
- Throwing
- Falling

Do not assume that changing mesh proportions alone is sufficient for animation compatibility.

Investigate whether the existing Meshy topology supports skeletal skinning.

If required, create or clean deformation loops near joints.

For extremely boxy body regions, consider whether controlled rigid-looking deformation or segmented meshes better preserve the art style.

Avoid visibly warped cubes and collapsing joint geometry.

Use test animations to verify deformation.

---

## 8. Helmet and Equipment Consistency

All characters must use a standardized equipment system.

Keep the following as identifiable, reusable components wherever feasible:

- Helmet
- Facemask
- Shoulder pads
- Gloves
- Cleats

The helmet should maintain a consistent shape and realistic size relationship to body height.

Do not enlarge the helmet merely because a player becomes heavier.

Equipment must stay correctly attached when body dimensions change.

Shoulder pads may adjust in width with shoulder proportions.

Gloves and cleats may scale modestly with hand and foot dimensions.

Use parented objects, bone attachments, or controlled transformations where appropriate.

Preserve the existing blue-and-white reference uniform initially.

Structure materials so team colors can eventually be changed programmatically.

---

## 9. Procedural Generation and Randomness

Implement deterministic generation using a seed.

Example input:

```python
player = {
    "seed": 17429,
    "position": "LB",
    "height_cm": 188,
    "weight_kg": 111,
    "archetype": "strong_athletic"
}
```

The generator should:
1. Load or duplicate the master base.
2. Resolve proportions from height, weight, and archetype.
3. Introduce bounded random variation.
4. Apply body modifications.
5. Adapt equipment.
6. Update the skeleton.
7. Validate geometry and proportions.
8. Produce a completed character.

The same seed and inputs must consistently generate the same character.

Store all resolved parameters so characters can be reproduced without depending on future changes to random-generation logic.

---

## 10. Blender Interface

Build a simple Blender UI panel under the 3D View sidebar.

Include:
- Height slider
- Weight slider
- Position/archetype dropdown
- Body proportion sliders
- Random seed input
- Randomize button
- Generate Player button
- Reset to Base button

Allow visual iteration without manually editing vertices.

Changing parameters should update the character predictably.

Prevent modifications to the immutable master model.

---

## 11. Technical Implementation

Use Blender Python (`bpy`).

Favor a maintainable parameterized deformation system rather than hardcoded mesh vertex indices.

Evaluate suitable implementation methods, including:

- Shape keys
- Bone-driven deformation
- Controlled per-region mesh transformations
- Procedural landmark-based deformation
- Geometry Nodes where useful

Select a solution that preserves the simple boxy topology and is practical for procedural generation.

Prefer reusable algorithms based on anatomical regions, landmarks, and mesh structure.

Avoid blindly scaling mesh objects independently in ways that create gaps or visible discontinuities.

Keep geometry lightweight.

Do not add subdivision modifiers.

Avoid generating unnecessary geometry as body sizes change.

Preserve material assignments.

Produce assets suitable for exporting as GLB or FBX.

---

## 12. Validation

Create automated checks for:

- Model height accuracy
- Ground contact
- Left/right symmetry
- Joint location consistency
- Helmet/head proportion
- Mesh intersection issues
- Triangle count
- Material integrity
- Skeleton hierarchy consistency

Create several test characters:

1. 5'8", 195 lb running back
2. 6'1", 195 lb wide receiver
3. 6'4", 225 lb quarterback
4. 6'2", 245 lb linebacker
5. 6'5", 270 lb defensive end
6. 6'6", 325 lb offensive tackle

Generate a comparison lineup with all six characters standing on the same ground plane, at the same scene scale.

Do not normalize their displayed heights independently.

Their size differences must be visually obvious and anatomically believable.

Generate a second test lineup with three players of the same position, height, and weight but different seeds, demonstrating controlled variation without extreme proportions.

Perform basic animation and deformation checks on the smallest and largest generated characters.

---

## 13. Development Approach

Implement this incrementally.

**Phase 1 — Import and analyze**
Inspect the supplied model, identify topology problems, and establish the master base.

**Phase 2 — Basic proportion controls**
Implement height, shoulder width, torso thickness, arm thickness, and leg thickness.

Verify visually before proceeding.

**Phase 3 — Full body parameterization**
Implement remaining continuous proportions and football archetype presets.

**Phase 4 — Skeleton compatibility**
Implement rigging adjustments and test representative animations.

**Phase 5 — Deterministic generation**
Add seeds, controlled randomness, presets, and parameter serialization.

**Phase 6 — Blender UI**
Expose the generator through a practical Blender interface.

**Phase 7 — Validation**
Generate test players, inspect proportions, test animation, and export example models.

Do not attempt the entire system in a single unvalidated operation.

Make a backup of the master model before changes.

Explain any limitations of the source topology and recommend corrective steps where necessary.

---

## Desired Final Deliverables

- A clean, reusable master player model.
- Blender Python scripts implementing procedural proportion scaling.
- Six football body archetype presets.
- A Blender UI for generation and adjustment.
- Shared animation-compatible skeleton setup.
- A saved Blender project demonstrating generated player variations.
- Example exported GLB files for the six test characters.
- A short guide explaining how to generate new players and export them.

**Most important requirement:** All generated players must look like variations of the SAME original boxy, low-poly character, not different independently generated 3D models.

Preserve the original visual identity: large flat surfaces, chunky geometric proportions, sharp edges, simple materials, and extremely lightweight geometry.

Start by analyzing the existing model and proposing the most suitable deformation strategy. Implement the first working version of height and body-width variation before expanding to the full generator.
