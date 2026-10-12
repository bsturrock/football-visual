# Claude Code Handoff — Start Here

## Your assignment
Build a procedural football-character rendering system for an existing Three.js CPU-vs-CPU coaching simulator. You are provided Meshy-origin GLB character/equipment models. Use them as **measured geometric references** and preserve them as immutable originals. The aim is to replicate the ultra-simple, chunky, boxy art style with lightweight, editable Three.js primitives and custom `BufferGeometry` shapes. Distinctive helmets/facemasks may be imported as exact GLBs instead of reconstructed.

Read these documents before coding:
1. `01_ARCHITECTURE.md` — goals, data model, runtime geometry, exact asset policy.
2. `02_IMPLEMENTATION_ROADMAP.md` — milestones and acceptance gates.

## Non-negotiable instructions
- **Do not recreate a Meshy mesh from screenshots when the actual GLB is available.** Import and inspect its geometry directly.
- **Do not claim a primitive reconstruction is identical to an original Meshy file.** Fidelity must be judged by comparison views.
- **Do not automatically remake a complex helmet/facemask.** Exact-use GLB fallback is explicitly encouraged.
- Keep the original source assets unchanged, with a separate working asset or geometry blueprint.
- Preserve boxy shapes: large flat planes, hard normals, matte solid colors, deliberately low geometric complexity.
- Do not rely on Blender at runtime. The finished game must generate appearance from reusable Three.js resources and stored parameters.
- Do not rewrite the core football simulation, camera system, routing, or unrelated UI.
- Do not build the entire generator until the medium player reconstruction has passed side-by-side comparison.

## Start with Milestone 0 and Milestone 1 ONLY
1. Inspect this repository's package manifests, Three.js setup, simulation/render boundary, existing character rendering and loaders.
2. Locate and enumerate provided Meshy GLB files, including separate helmet/facemask exports when present.
3. Implement a GLB inspector that extracts **actual** hierarchy, mesh node names, dimensions, transforms, material metadata, and triangle counts.
4. Normalize a consistent world axis and units for measurements, without altering the originals.
5. Create front/side/three-quarter orthographic renders of original GLBs, preferably in an inspection viewer.
6. Create `meshy_analysis.json` and an editable `landmarks.json`, where unknown landmarks are flagged instead of invented.
7. Explain whether the supplied files have identifiable separate body parts, or a single complex merged triangle soup.
8. Propose the smallest feasible implementation for Milestone 2, but **stop before implementation** until I approve.

## Deliver a concise review
- Exact input file paths that were successfully opened.
- Summary of mesh stats and object structure.
- Screenshots or launch instructions for inspector viewer.
- Risks: coordinate orientation, closed-shell assumptions, fused equipment, asymmetric triangles, uncertain landmarks.
- Recommended next steps for a faithful medium-player reconstruction.

## Expected future architecture (do not implement yet)
```ts
type Appearance = {
  schemaVersion: number;
  generatorVersion: string;
  playerId: string;
  seed: number;
  position: string;
  heightCm: number;
  weightKg: number;
  body: Record<string, number>;
  face: Record<string, number | string>;
  equipment: { helmetId?: string | null; facemaskId?: string | null; visorId?: string | null };
  uniform: { primary: string; secondary: string };
};

function createFootballPlayer(appearance: Appearance): THREE.Group;
```

The final renderer consumes animation states and transforms from the existing simulation. It does not implement football decision-making or physics.

## How to resolve design tradeoffs
- Prefer fit-to-reference custom boxes/prisms for body parts.
- Prefer preserved exact GLBs for complicated equipment.
- Prefer practical, adjustable joints over premature complex skinning.
- If 600 triangles looks worse or animates poorly than 1,200, keep the better silhouette and movement.
- When a measurement can't be recovered from the original geometry automatically, request a landmark annotation rather than guessing.
