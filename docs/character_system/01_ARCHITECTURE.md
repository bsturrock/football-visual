# Football Character System — Architecture

## Purpose
Build a lightweight, procedural character system for a Three.js CPU-vs-CPU American football coaching simulation. Meshy GLB assets supply geometric measurements and art direction. A small number of native Three.js primitives and custom `BufferGeometry` shapes form the runtime players. Distinctive equipment can remain exact imported GLBs when procedural approximations look worse.

## Visual contract
- Super-boxy, toy-like football figures; strong silhouettes readable at elevated broadcast distance.
- Big flat planes, crisp/hard edges, simple flat matte colors, no baked shadows or realistic fabric detail.
- Same anatomical conventions and equipment proportions across positions.
- Medium T-pose is the master reference. Variation means changing measurements, **not independently inventing new models**.
- Design for a distant TV camera, with optional close-up replay and helmetless player-card portraits.

## End-to-end pipeline
```text
Meshy medium player GLB (+ separate helmet/facemask GLBs)
             │
             ▼
Reference analyzer (offline, Node/Three.js or Blender Python)
  • exact bounds, transforms, triangles, materials, disconnected parts
  • orthographic front/side/three-quarter screenshots
  • annotated landmarks, object/part segmentation
             │
             ▼
versioned reference blueprint JSON + original assets (immutable)
             │
             ▼
Three.js procedural builder
  • custom flat-faced torso and tapered limb shapes
  • joint-centered articulated hierarchy
  • optional original imported equipment
             │
             ▼
Three.js runtime appearance generator
  • height, weight, position distributions, seed
  • face + hair, equipment choices, uniform palette
             │
             ▼
render in existing simulation + portraits
```

## Critical distinction: reference versus exact imported assets
**Procedural approximation:** body, arms, legs, hips, hands, shoes, simple heads. Use actual GLB dimensions and contours to tune native primitives; pixel-perfect/vertex-perfect equivalence is not expected.

**Exact reuse:** helmet, facemask, visor, or any distinctive piece where preservation matters. Import the real Meshy geometry without remeshing, rebuilding, retopology, or translating vertices into guessed primitives. Mount it via a well-defined transform and attachment pivot.

When fitting an existing helmet, compare both the head clearance and the actual player model. A visual model with a dark face opening is not automatically a truly hollow, wearable mesh; inspect its cavity and internal surfaces.

## Three.js geometry architecture
```text
CharacterRoot (world transform controlled by football simulation)
└─ PelvisPivot
   ├─ PelvisGeometry
   ├─ SpinePivot
   │  ├─ TorsoGeometry
   │  ├─ NeckPivot → HeadPivot → Head / Hair / Helmet / Facemask / Visor
   │  ├─ LeftShoulder → LeftUpperArm → LeftElbow → LeftForearm → LeftWrist → Hand
   │  └─ RightShoulder → RightUpperArm → RightElbow → RightForearm → RightWrist → Hand
   ├─ LeftHip → LeftThigh → LeftKnee → LeftShin → LeftAnkle → Foot
   └─ RightHip → RightThigh → RightKnee → RightShin → RightAnkle → Foot
```
Start with an articulated, rigid-segment rig. Each component is shaped relative to its own pivot; pivots stay at measured anatomical joints. Use controlled overlap/joint caps to prevent gaps, then assess whether selected zones need skinned deformation. Avoid automatically introducing a complex skinned mesh.

## Geometry vocabulary
| Body part | Preferred geometry |
| --- | --- |
| Torso | Tapered rectangular prism / custom six-to-twelve-sided silhouette |
| Pelvis | Box or chamfered wedge |
| Upper/lower limbs | Rectangular or low-sided tapered prisms |
| Hands | Small boxes or mitts |
| Feet | Angular wedge boxes |
| Neck / head | Simple faceted custom geometry |
| Shoulder pads | Separate flat-faced attachments |
| Helmet / facemask | Preserve exact Meshy GLB first; optional procedural replacement only after comparison |

Use indexed or non-indexed `BufferGeometry` as needed to control flat normals. Many triangle faces can still look smooth under averaged vertex normals; select intentional hard normals and avoid accidental bevels. A narrow triangle budget is a guideline, not an excuse to starve joints or ruin silhouettes.

## Runtime player appearance data
Example schema (illustrative control ranges, not measurements from Meshy):
```json
{
  "schemaVersion": 1,
  "generatorVersion": "0.1.0",
  "playerId": "p_1042",
  "seed": 72941,
  "position": "OT",
  "heightCm": 198,
  "weightKg": 145,
  "body": {
    "shoulderWidth": 0.8,
    "chestDepth": 0.9,
    "waistMass": 0.88,
    "armThickness": 0.81,
    "thighThickness": 0.91,
    "legLength": 0.58
  },
  "face": { "headArchetype": "square", "jawWidth": 0.7, "noseWidth": 0.55 },
  "equipment": { "helmetId": "helmet_primary", "facemaskId": "mask_standard", "visorId": null },
  "uniform": { "primary": "#245BD6", "secondary": "#FFFFFF" }
}
```
**Persist resolved appearance values, seed, and generator version.** Generating with a seed alone is insufficient to preserve identity if generation rules change later.

## Proportions
- Establish a measured **medium baseline** from the real Meshy source. Normalize units and coordinates once.
- Height primarily modifies thigh/shin and torso segment lengths; keep feet on the ground and recompute pivots.
- Weight maps to regional volume using position-informed distributions, not uniform whole-character scaling.
- Head, helmet, hands and feet vary within narrow defensible ranges, rather than swelling proportionately with body mass.
- Linemen: broad shoulder/waist/depth, thick limbs; WRs/CBs: lean limbs and narrower torso; RBs: compact, substantial thighs; QB: balanced or tall; LB: strong and athletic.
- A slider is not a biological model. Use visual validation and keep ranges tunable.

## Face system for player cards
- Initial target: one simple boxy head with ~8–12 controls (width, height, jaw, chin, brow, cheek, nose, eye spacing, neck).
- Add modular hair, eyebrow, and beard options plus a skin-tone palette. Keep hair and face in the same art family.
- For on-field gameplay, helmet obscures the face; prioritize portraits and post-play shots. The portrait renderer can use the same identity data with an alternate head LOD.
- Optional aging: deterministic time evolution of hairline, gray hair, beard, face width/posture changes. Avoid making everyone age in exactly the same way.

## Modularity / precise equipment integration
- Ship exact imported helmet GLBs when needed, cached and cloned appropriately.
- Standardize local coordinate axis, asset scale, mount pivot, head clearance, and `helmetOffset` values.
- Make facemask and optional visor independent toggles **only if** they are separable meshes. If a GLB is fused, split it offline or create discrete assets; a text prompt does not ensure separability.
- Do not modify original Meshy geometry while analyzing. Preserve source assets verbatim.

## Rendering / performance
- Initial reference budget: roughly 600–1,200 triangles per complete procedural player **as a starting point**; not a hard rule. Keep head and equipment geometry where it improves silhouettes or animation.
- 22 on-field animated players are modest in raw triangles; profile draw calls, animation updates, shadows, crowds, and simulation logic.
- Share geometry and material instances where possible; cap material count. Basic `InstancedMesh` does not automatically provide unique articulated skeletal animation per instance.
- For crowded scenes, use distance-based character simplification and reduced shadow complexity.
- Keep simulation authoritative for locomotion and collisions. The character renderer consumes simulation state; it should not independently choose outcomes.

## Success criteria
- Medium procedural reconstruction is recognizably close to original Meshy model front/side/three-quarter and at broadcast distance.
- Six real-scale archetypes use one articulated component structure; no accidental helmet scale changes.
- Running, crouching, blocking and tackling do not reveal glaring gaps/collisions.
- Same saved appearance data produces same face/body/equipment after reload.
- Original Meshy equipment can be imported and attached unchanged if procedural recreation fails.
