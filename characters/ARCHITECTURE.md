# Procedural Football Player Generation — Blender → Three.js

## Objective

Build a lightweight, deterministic football-player appearance system for a Three.js CPU-vs-CPU coaching simulator. **Blender is an offline asset-authoring tool, not a runtime dependency.** The game loads a small set of reusable assets and assembles distinct players from roster data at runtime.

### Visual target

- Extremely simple, boxy, toy-like, low-poly models based on the approved medium T-pose reference.
- Large flat surfaces, crisp hard edges, minimal bevels, matte solid-color materials.
- Recognizable helmets, shoulder pads, jersey, pants, gloves and cleats.
- Readable player silhouettes at an elevated TV/skybox camera angle, with enough joint geometry for running, blocking, throwing, tackling and replays.
- Consistent anatomical landmarks and equipment proportions across all generated players.

**Initial target:** ~800–1,400 triangles per complete on-field player, with **~1,200 triangles** as the initial master-model target. These are starting budgets; test rig deformation and the intended camera distances before locking them in. Flat-shaded topology and broad planar shapes matter more than the exact count.

## System architecture

```text
OFFLINE / DEVELOPMENT
Meshy medium T-pose reference → Blender cleanup
  → standardized base body + equipment components
  → canonical rig / skin weights / animations
  → optional body morph targets and archetype presets
  → GLB assets + generator configuration
                        │
                        ▼
RUNTIME / THREE.JS
Roster data (height, weight, position, appearance seed)
  → deterministic appearance resolver
  → load/clone reusable rigged character
  → apply body parameters, equipment and team materials
  → play shared animations in the game
```

There is **no Blender or Meshy generation on the user's machine during gameplay**. Existing assets are downloaded with the game; only their parameters change. Creating a player should be fast enough for roster screens and game initialization.

## Recommended delivery strategy

### Phase A — Ship an MVP with stable archetypes

Start with **three Blender-authored and tested bodies** derived from the same master: small/lean, medium/athletic, large/heavy. Share bone naming conventions, animation expectations, and equipment design. Three.js selects a body and varies overall height moderately, skin/material colors, and accessories.

This gets 22 animated players on the field without depending on difficult runtime deformation code. **Three separate files can still share the same animation clips**, provided their rigs and rest-pose conventions are compatible and retargeted/tested where required.

### Phase B — Continuous variation

Move toward **one parameterized master** (or a small set of interchangeable shape families) with Blender-authored body morph targets. Three.js interpolates shape parameters for shoulder width, chest, waist, arm thickness, leg thickness, etc. Height and limb-length variation can use authored deformation controls or carefully coordinated rig adjustments.

Do not assume that directly scaling individual bones will keep skinning and connected joints correct. Prototype this in Blender and Three.js on the same exported rig.

## Blender asset authoring requirements

### Master character

- Use the approved **medium T-pose** as the authoritative proportions and style reference.
- Establish real-world scale, +Y/up or engine-specific axis conversion rules, facing direction, and a ground plane. Document export/import transforms.
- Make a clean, symmetric reference pose and record anatomical landmarks: helmet top, neck, shoulder, elbow, wrist, hip, knee, ankle and sole.
- Keep character proportions believable; never create a heavy player simply by enlarging the head.
- Avoid floating geometry, merged limbs, unstable topology, extreme material counts and unnecessary subdivisions.
- Keep appropriate deformation loops at critical joints, even if the torso and limbs are very boxy.

### Rig and animation

- One canonical bone naming scheme, hierarchy, and rest-pose convention.
- Skin weights verified for shoulders, elbows, hips, knees and ankles.
- Basic motion tests: idle, jog, sprint, change direction, block, tackle, fall, jump, catch and throw.
- Verify the large and small shapes against the **same animation library**. Retarget or correct clips where body proportions change substantially.
- Equipment attaches to the correct bone or uses suitable skinning, so helmet, facemask, pads and cleats remain aligned.

### Materials and modular parts

- Prefer a small number of matte materials and solid color blocks over detailed textures.
- Keep uniform primary/secondary colors configurable in Three.js; number decals may be handled with an atlas or dedicated material if needed.
- Helmet shell, facemask and accessories should be individually identifiable and replaceable where practical.
- Preserve hard shading/flat polygon appearance after GLB export. Test in the actual Three.js renderer, not only Blender.

### Suggested output assets

```text
public/assets/players/
  base-medium.glb
  archetype-small.glb         # Phase A; optional in Phase B
  archetype-large.glb         # Phase A; optional in Phase B
  animations.glb              # optional separate animation library
  equipment/                  # optional modular GLBs
    facemasks.glb
    helmets.glb
  player-generator-config.json
```

GLB is the primary Three.js distribution format. These names are illustrative; export packaging may combine several assets.

## Player appearance data contract

The football sim owns the canonical player data. The appearance system derives a reproducible **visual specification** from it.

```json
{
  "playerId": "p_10482",
  "position": "LB",
  "heightCm": 188,
  "weightKg": 111,
  "appearanceSeed": 483921,
  "appearanceVersion": 1,
  "visualOverrides": {}
}
```

Resolved visual parameters might look like:

```json
{
  "archetype": "strong-athletic",
  "heightScale": 1.015,
  "wideShoulders": 0.82,
  "chestMass": 0.68,
  "waistMass": 0.45,
  "thickArms": 0.75,
  "thickThighs": 0.73,
  "helmetVariant": 0,
  "facemaskVariant": 2,
  "skinToneIndex": 3,
  "gloveVariant": 1
}
```

- **Height and weight** establish plausible broad body proportions; **position** biases the distribution rather than enforcing a rigid shape.
- **Appearance seed** introduces bounded differences between similarly sized players.
- Save the **resolved appearance parameters and version**, not only the random seed, so visual identities survive generator updates.
- Team uniforms are separate from identity: trades change jersey colors without changing a player's face/body.
- Keep athletic ratings and physical appearance loosely related, not identical: a player's speed rating need not directly change geometry.

## Runtime Three.js design

### Modules

```text
src/characters/
  CharacterAssets.ts      # load/cache GLBs, animations, materials
  AppearanceResolver.ts   # height/weight/position + seed → parameters
  PlayerFactory.ts        # clone rig, apply appearance, equip uniform
  BodyCustomizer.ts       # apply morphs / validated height controls
  EquipmentManager.ts     # helmets, facemasks, gloves, accessories
  AnimationController.ts  # football state → shared clips
  PlayerLOD.ts            # camera-distance simplification
  PlayerPreview.ts        # reusable player-card preview setup
```

### Loading and cloning

Use `GLTFLoader` to load the GLB and `SkeletonUtils.clone()` for independent copies of a rigged character. Cache assets, and share immutable resources where safe. Each player receives its own pose/animation state.

Illustrative TypeScript/pseudocode:

```ts
async function createPlayer(data: PlayerData, team: TeamUniform) {
  const source = await characterAssets.load(data.position);
  const root = SkeletonUtils.clone(source.scene);
  const visual = resolveAppearance(data); // seeded + stored params

  applyBodyAppearance(root, visual);       // morphs or tested archetype controls
  applyEquipment(root, visual);
  applyTeamUniform(root, team);

  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, appearance: visual };
}
```

This is a design sketch, **not** drop-in code. Morph dictionary names, mesh references, bone rest poses and equipment sockets must correspond to exported assets.

### Continuous body morphs

In Blender, author shape keys such as `WideShoulders`, `ChestMass`, `WaistMass`, `ThickArms`, `ThickThighs`. Export these as glTF morph targets and confirm they survive in the output GLB. In Three.js, look up each target by name using the mesh's `morphTargetDictionary` and set its corresponding `morphTargetInfluences` value.

For the very boxy style, design each target to preserve broad flat planes. Arbitrary vertex displacement can create irregular, visibly warped faces. Meshy topology may require manual cleanup before morphing is feasible.

### Height and skeletal proportions

For the MVP, moderate uniform height scaling is acceptable as a temporary compromise if it looks right. For stronger height differences, adjust upper/lower legs and torso using authored geometry/rig controls that move joints and attachments together. Validate animation and root-motion alignment after scaling.

**Avoid naive bone scaling** until tested: it can distort weighted geometry, create gaps and misalign equipment. Where necessary, use multiple tested stature presets or bake variants offline.

## Example position distribution

| Position family | Height tendency | Shape tendency | Visual goal |
|---|---|---|---|
| WR / CB | Variable, often lean | Narrow waist, slender arms | Fast/lean silhouette |
| RB | Often compact | Thick legs, lower center | Explosive silhouette |
| QB | Often taller | Balanced torso, athletic limbs | Upright, composed silhouette |
| LB / TE | Medium–tall | Wider shoulders, strong arms | Powerful athletic silhouette |
| OL / interior DL | Often tall and heavy | Broad chest, waist and thighs | Massive blocking silhouette |

Ranges are customizable. Outliers are important for making a generated league feel varied.

## Rendering and performance

- Aim initially for **~1,200 triangles per player**; 22 players ≈ **26,400 triangles** before accessories, other field characters and stadium content.
- Measure **draw calls, skeleton updates, animation mixing, shadows, materials, collision/physics and stadium crowd** in addition to triangles.
- Reuse cached geometries, animations and materials where possible; do not load the same GLB for every player.
- A standard `InstancedMesh` does not automatically provide independent skinned animation for all players. Start with individually cloned `SkinnedMesh` rigs and profile performance.
- Implement LOD or reduced update frequency for distant players only once profiling justifies it.
- For player cards, use the same appearance parameters with a separate preview camera and, if needed, a higher-quality portrait head/helmetless variant.

## MVP milestones and acceptance tests

### 1. Verify the Meshy → Blender → Three.js pipeline

Import medium T-pose, clean it, export GLB and confirm it looks **equally boxy** in Three.js. Check triangle count, shading, colors, pose, origin and scale.

### 2. Rig and animate one player

Demonstrate idle, run, block and tackle. Inspect elbows, knees and shoulders from both the standard broadcast camera and a close replay camera.

### 3. Generate three recognizable bodies

Create and display at the same scene scale:

| Test athlete | Height | Weight | Expected shape |
|---|---:|---:|---|
| RB | 5'8" | 195 lb | Short/compact; thick legs |
| LB | 6'2" | 245 lb | Medium/tall, powerful and athletic |
| OT | 6'6" | 325 lb | Tall, wide, large waist/limbs |

Same equipment family, helmet style, skin tone and T-pose for this comparison. **Do not normalize all three characters to the same displayed height.**

### 4. Add seeded visual variation

Generate 20 linebackers with similar measurements but unique seeds. Check that each is distinct without becoming cartoonishly disproportionate. Re-run with identical inputs and verify stable output.

### 5. Full 22-player test

Load two teams, assign team colors and play coordinated animation clips. Profile frames per second, draw calls and CPU cost with the real stadium/crowd scene.

### 6. Connect to player cards and saved rosters

Generate a preview from the same saved appearance configuration. Confirm visual continuity between roster cards, gameplay and replays. Verify appearance persistence after reloading saved games.

## Guidance for Claude Code

**Start by inspecting the existing project and exported Meshy model.** Do not implement a complete generator until the medium-model GLB loads, rigs and renders correctly. Propose the smallest robust MVP, then deliver one working vertical slice: load the master, produce small/medium/large athletes, animate them with shared clips, and view them in a simple Three.js comparison scene.

Prioritize testable code, stable asset names and a documented appearance JSON schema. Clearly flag any Blender-side fixes that cannot be reliably automated because of the source mesh topology.

## Key design decision

**Blender authors reusable deformation capability; Three.js chooses and applies player appearances at runtime.** Never generate a new GLB for each randomly generated football player. Only bake separate archetypes or height variants if runtime deformation proves too fragile for the supplied low-poly mesh.
