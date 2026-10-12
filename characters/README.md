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

1. **Facemask:** kept as modelled (an earlier flat-plate replacement was reverted; the original cage
   looks better). Mirroring makes it symmetric. It has 2 harmless edges shared by 4 faces.
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

## Next: Milestone 2 (rig + animate one player)

See the review notes in the project discussion; requirements are tracked in `ARCHITECTURE.md`.
