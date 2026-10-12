# Player models (side project)

Work toward the asset-based player pipeline described in [`ARCHITECTURE.md`](ARCHITECTURE.md).
It lives in this folder and does not touch the live game: the game (`/`) still uses
the procedural box players in `src/engine/`.

- **Viewer:** `characters/index.html` (on Pages: `/characters/`). Orbit with the mouse.
  Views: single player (position, height, weight, seed, presets), the 6-player test lineup,
  5 seeds at the same size, and base vs. current box player. Skin tone swatches, camera presets
  (incl. broadcast distance), wireframe, height ruler (red = 6'1", purple = 6'6").
  URL parameters: `view=single|test|seeds|compare`, `position`, `h` (in), `w` (lb), `seed`, `skin` (0–6), `cam`, `wire`.
- **Source (never modified):** `source/med-base-low-poly.glb`, the approved medium T-pose from Meshy.
- **Prepared asset:** `assets/base-medium.glb`, built by `tools/prep_base.py`.

## Milestone 1: Meshy → Blender → Three.js ✅

```
pip install bpy==4.2.0
python3 characters/tools/prep_base.py -- characters/source/med-base-low-poly.glb characters/assets/base-medium.glb
```

| Check | Result |
|---|---|
| Triangles | 1,420 (one connected mesh, exactly symmetric) |
| Shading | flat, matte (metallic/roughness map removed) |
| Colours | base-colour texture, 1024 px |
| Pose | T-pose, exactly symmetric (mirrored) |
| Scale / origin | 1.854 m (6'1") to the helmet top, feet at y = 0, centred |
| Facing | +Z (glTF), same as the game's rigs |
| File size | 1.5 MB |

### Export / import conventions

- Blender: Z up, front faces −Y. glTF / Three.js: Y up, front faces +Z (the exporter converts).
- Units: metres in the asset. The game works in yards (× 1.0936 when placed in the game).

### Source fixes (scripted in `prep_base.py`)

1. **Facemask:** geometry kept exactly as modelled. Faces at the outer ends of the lower mask (where it
   joins the helmet) were painted dark in the texture and read as holes; they're recoloured white.
   2 harmless edges shared by 4 faces remain.
2. **Back of the neck:** faces painted dark grey are recoloured to skin (UVs point at a skin texel).
3. **Symmetry:** the mesh is cut at x = 0 and the +X half (player's left, the cleaner side) is
   mirrored, so chest, pelvis, helmet and limbs are exactly symmetric. The centre cut adds ~190 triangles.
   `MIRROR_KEEP=-1` keeps the other half instead.

Remaining, acceptable at game scale: ear pieces are thin wedges; colours are painted across
triangles (fine with the texture; per-face solid colours would need edge loops at colour borders).

## Body variation in the viewer (`src/BodyCustomizer.js`)

A first, simple version of Milestone 3, used by the viewer:
- `reshape(baseGeometry, body)` reshapes a copy of the base mesh from a resolved body
  (`src/engine/Body.js`, same parameters as the live game). Height stretches legs (more) and
  torso; the helmet is moved, never scaled. Weight widens torso / waist / hips / legs and arm
  thickness by region. Arms move out with the shoulders.
- `skinTexture(texture, tone)` recolours the skin texels.
- Landmarks (`BASE`) are measured from `base-medium.glb`. The same landmarks will position the
  skeleton joints in Milestone 2 so mesh and rig stay aligned.

## Milestone 2: rig + animate ✅ (first pass)

```
python3 characters/tools/rig_base.py -- characters/assets/base-medium.glb characters/assets/base-medium-rigged.glb
```

- **Skeleton:** 17 bones named after the game's animator joints (`pelvis, spine, chest, neck, head,
  shL/elL/handL, shR/elR/handR, hipL/knL/ankL, hipR/knR/ankR`), placed on landmarks measured from the
  mesh's colour bands (knee skin band, wristband, glove, sock, cleat).
- **Weights:** automatic (bone heat) on the welded mesh, max 4 per vertex. (A rigid-pad override was
  tried for the arms-up pose and reverted: it made everyday arm poses look wrong. Arms-up pinches a
  little; to revisit gently.)
- **Runtime (`src/PlayerRig.js`):** each player gets a reshaped geometry and a skeleton whose joints
  are moved by the same `mapPoint` function, then re-bound, so every height/weight is rigged correctly.
  The game's `Animator` drives an invisible proxy joint hierarchy (arms-down convention); its world
  rotations are copied onto the bones through bind offsets (`bone = proxy × offset`).
- **Viewer poses:** T-pose, idle, run, sprint, backpedal, shuffle, 3-point / 2-point / WR stance,
  block, tackle, catch (arms up), throw, fall. URL `pose=…`, `speed=1|0.5|0.25|0`.

Known: neck has almost no own vertices (helmet + collar are weighted to head/chest), fine for now;
forearms can clip the chest in the block pose.

## Milestone 2.5: separate helmet (in progress)

```
python3 characters/tools/prep_helmet.py -- characters/source/helmet.glb characters/assets/helmet.glb
```

- **Helmet** (`source/helmet.glb` from Meshy, 408 tris, hollow, facemask matching
  `docs/reference/facemask.png`): mirrored for exact symmetry (the −X half, whose facemask has the
  two large + two narrow lower openings),
  scaled to the body's old helmet (0.36 m wide, bottom at 1.48 m, mask front 0.18 m ahead), origin at
  the head joint. Otherwise used exactly as modelled: the provided mesh is the reference (an earlier
  "boxier" reshape was reverted). 570 tris, 0 bad edges.
- **Body:** `rig_base.py` removes the fused helmet (390 faces) before weighting.
- **Runtime:** helmet and a placeholder boxy head are attached rigidly to the head bone (fixed
  size on every body). The placeholder head is only shown with the helmet off. Viewer: **Helmet**
  checkbox (`helmet=0`).

### Still to do in 2.5
1. Seeded faces (eyes, brows, mouth) and hair / facial hair pieces to replace the placeholder head.
2. Helmet team colours (stripe, shell, mask) recoloured per uniform.
3. A real head that fits inside the helmet (so a face can show through the visor without poking through).

Then Milestones 3–4 (body tuning, 20-linebacker variation test), 5 (22 players in the game).
