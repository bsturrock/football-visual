# Player models (side project)

Work toward the asset-based player pipeline described in [`ARCHITECTURE.md`](ARCHITECTURE.md).
It lives in this folder and does not touch the live game: the game (`/`) still uses
the procedural box players in `src/engine/`.

- **Viewer:** `characters/index.html` (on Pages: `/characters/`). Orbit with the mouse,
  pick camera presets, toggle wireframe and the height ruler, compare against the current box player.
- **Source (never modified):** `source/med-base-low-poly.glb`, the approved medium T-pose from Meshy.
- **Prepared asset:** `assets/base-medium.glb`, built by `tools/prep_base.py`.

## Milestone 1: Meshy → Blender → Three.js ✅

```
pip install bpy==4.2.0
python3 characters/tools/prep_base.py -- characters/source/med-base-low-poly.glb characters/assets/base-medium.glb
```

| Check | Result |
|---|---|
| Triangles | 1,230 (one connected, closed mesh, 610 vertices) |
| Shading | flat, matte (metallic/roughness map removed) |
| Colours | base-colour texture, 1024 px |
| Pose | T-pose, symmetric |
| Scale / origin | 1.854 m (6'1") to the helmet top, feet at y = 0, centred |
| Facing | +Z (glTF), same as the game's rigs |
| File size | 1.5 MB |

### Export / import conventions

- Blender: Z up, front faces −Y. glTF / Three.js: Y up, front faces +Z (the exporter converts).
- Units: metres in the asset. The game works in yards (× 1.0936 when placed in the game).

### Known source issues (manual Blender fixes recommended)

These are in the Meshy geometry/texture and are not reliably fixable by script:

1. **Lower facemask openings:** crumpled sliver triangles around the two lower openings, and the
   only 2 non-manifold edges in the mesh (each shared by 4 faces), at roughly
   (−0.085, −0.161, 0.625) and (0.127, −0.137, 0.686) in source units. Rebuild the lower mask bars as clean quads.
2. **Back of the neck** is painted dark grey in the texture; it should be skin or jersey collar.
3. **Ear pieces** are thin wedges; fine at game distance, worth squaring off.
4. **Colours are painted across triangles**, not on face boundaries. Fine with a texture; if we
   move to solid per-face colours (better for team colours), the colour borders need edge loops.

## Next: Milestone 2 (rig + animate one player)

See the review notes in the project discussion; requirements are tracked in `ARCHITECTURE.md`.
