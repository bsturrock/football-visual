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

## Facemask update ✅

The original helmet on the base model is kept exactly as modelled. Only its facemask is replaced, by
the facemask from the provided helmet (`source/helmet.glb`, which matches `docs/reference/facemask.png`):

- `prep_base.py` takes the facemask faces from `helmet.glb` (frame, cross bar, lower bars, side bars;
  129 faces), scales them uniformly to the old facemask's width (×0.26), aligns bottom and centre, and
  sets them 5 cm forward so the whole mask sits in front (as on the provided helmet). It's flipped in X
  so the half with the reference layout (two large + two narrow lower openings) is the one mirrored.
- The old cross bar + cage (71 faces) are painted dark, so they read as shadow behind the new bars;
  no holes are cut in the original helmet. Where the facemask joins the helmet (outer columns of the
  old cage, visor side walls, below the mask's bottom bar) everything is white, so the connection is
  solid with no black slivers; only the visor and the mask's openings stay dark.
- The facemask is white (body texture) and weighted to the head by the rig step.

## Next (to agree)

- A separate helmet item (helmet on/off), heads, faces and hair were discussed; on hold until
  agreed. If done, the original helmet stays the reference.
- Then Milestones 3–4 (body tuning, 20-linebacker variation test), 5 (22 players in the game).
