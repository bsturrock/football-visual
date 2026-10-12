# Milestone 1 — Meshy GLB inspection report

All numbers come from the GLB files themselves (`tools/inspect/inspect_glb.py`, `cavity_probe.py`,
`render_views.py`). Originals are stored verbatim in `assets/meshy/source/` (sha256 matches the upload)
and were never modified or re-exported.

## Files opened
| File | sha256 (first 12) | Size |
|---|---|---|
| `assets/meshy/source/new-base-player.glb` | `abb4346c2c6b` | 2.7 MB |
| `assets/meshy/source/new-base-helmet.glb` | `1f2fe62c9a3a` | 3.9 MB |

Both were written by `pygltflib` (re-packed after Meshy) and are **normalised**: bounds centred exactly on the origin.

## Player — `new-base-player.glb`
- 1 node (identity transform), 1 mesh, 1 material, 1 JPEG texture (2048²). No skin, no animations.
- **3,486 triangles**, 3,130 vertices (1,745 after welding UV seams).
- **One connected, watertight part**: no open edges, no non-manifold edges, no degenerate triangles.
  So it's a single merged shell. There are no separate body parts; parts are identified by colour borders and geometry slices.
- **Symmetric**: 96% of vertices mirror across X within 1 mm (max 2 cm).
- Faces +Z, Y up, +X = player's left. T-pose, arms level at y≈1.37.
- Height 1.82 m to the top of the hair, arm span 1.906 m. Scale is assumed to be metres (the file is normalised).
- Material: base colour texture only, metallic 0, roughness 0.8, double-sided.
- Colours (share of surface area): blue 48%, white 27%, skin 16%, hair/brows 5%, cleat sole grey 1.6%.
  Colours are painted cleanly per region: good for measuring, and team recolouring isn't needed because the body is rebuilt procedurally.
- Landmarks: `analysis/landmarks.json`. 16 observed and 7 inferred. **Elbow, shoulder joint, hip joint, knee, ankle and head pivot have no visible
  marker** and are estimates to confirm.

## Helmet — `new-base-helmet.glb`
- 1 node, 1 mesh, **858 triangles**, one watertight part. **The facemask is fused to the shell**, so a separate facemask/visor toggle
  would need an offline split (the docs require approval for that).
- Size 0.766 × 0.738 × 0.952 m: **about 2.2× real size**. It needs a uniform scale (about 0.45) when mounted.
- Faces +Z. Less symmetric than the body (64% of vertices mirror within 1 mm, max 10 cm).
- Material: **metallic 1.0** + metal/roughness texture, plus 3 × 2048² JPEG textures. In Three.js this would render as dark chrome.
  Needs the approved material change (metalness 0, flat colours per team).
- **Cavity (ray-cast sections):** the dome and the back half are **solid**. There is a face pocket at the front, open at the bottom,
  about half the helmet's depth, with a shallow visor recess above the lower mask. It's not a wearable hollow, but it doesn't need to be:
  any part of the head inside the solid is simply hidden.

## Provisional fit (analysis only, not a deliverable)
`analysis/renders/provisional_fit_sheet.png`: helmet uniformly scaled ×0.45 and placed by hand on the head.
- Eyes, nose, mouth and chin are visible through the visor and mask.
- The proportions read correctly at full-body scale.
- Hair pokes through the top of the dome. Expected; in the procedural build hair is a separate piece, hidden when the helmet is on.

## Risks
| Risk | Status |
|---|---|
| Coordinate orientation | Both +Z front, +Y up. Game rig is the same; metres → yards ×1.0936 |
| Absolute scale | Both files normalised; player taken as 1.82 m, helmet fitted relative to the head |
| Closed-shell assumption | Verified: both watertight; helmet has a front face pocket, the dome is solid |
| Fused equipment | Facemask fused to the helmet shell. Fine for one standard mask; split needed for mask variants |
| Asymmetry | Body near-perfect; helmet up to 10 cm off in places (visible only on close inspection) |
| Uncertain landmarks | 7 joint centres inferred, listed in `landmarks.json` |
| Helmet material | Metallic 1.0 must be overridden (approved) |

## Proposed Milestone 2 (smallest version) — awaiting approval
1. `src/engine/characters/shapes.js`: tapered prism, wedge and faceted-box builders with flat normals (generalising the `tbox` already in `PlayerModel.js`).
2. `src/engine/characters/mediumPlayer.js`: `createMediumPlayer()` builds the T-pose medium player from `landmarks.json` numbers.
   - Uses the **existing 17-joint hierarchy and names**, so the Animator works later without changes.
   - Body parts: pelvis/pants, torso/jersey, shoulder pads, sleeves, arms, wristbands, gloves, thighs, knees, socks, cleats, neck, head (face, brows, hair as separate pieces).
   - Region vertex colours (team-recolourable), one shared flat-shaded material.
3. `tools/compare/index.html`: Meshy GLB and procedural player side by side and overlaid, same orthographic camera.
   - Front / side / ¾ / broadcast presets, wireframe, opacity slider.
   - Headless screenshots for the review.
4. Helmet stays out of Milestone 2 (it's Milestone 6). The live game is untouched.

Gate: you review the comparison renders before Milestone 3.

---

# Milestone 2 — medium player reconstruction (for review)

- `src/engine/characters/shapes.js`: `loft()` (flat-faced solid through rectangular/chamfered sections), `boxR()`, mirroring helpers.
- `src/engine/characters/mediumPlayer.js`: `createMediumPlayer()` and `tPose()`. Every dimension comes from the GLB:
  `landmarks.json` plus exact plane sections (`tools/inspect/slice_glb.py`).
  - Built on the game's 17 joint names with the arms-down rest pose.
  - Hair is a separate mesh (`rig.hair`).
  - Colours are vertex-colour regions on the shared player material.
- `tools/compare/index.html`: Meshy and procedural side by side or overlaid, front/side/back/¾/top/broadcast, zoom on head/arm/leg,
  wireframe, opacity, `pose=rest`. `tools/compare/shoot.py` writes `analysis/compare/*.png`.

| | Meshy | Procedural |
|---|---|---|
| Size (m) | 1.906 × 1.820 × 0.419 | 1.906 × 1.822 × 0.424 |
| Triangles | 3,486 | 2,040 |
| Meshes | 1 | 18 (one per joint + hair) |

Known differences (judge in the renders):
- **Head:** the Meshy jaw and cheek planes are more sculpted, the ears are larger and pointed, and the back of the hair is rounder.
- **Glove:** the Meshy fingers taper to a point and the thumb angles down.
- **Arms-down pose:** shoulder pads stick out like wings (they're sized for the T-pose). That's Milestone 3 work (joint caps / pad shape).
- **Triangle count:** 2,040 is above the 600–1,200 starting budget. The biggest costs are the head (256), cleats (192 each) and thighs (192 each).
  It can come down: fewer chamfers and sections, simpler studs. I kept fidelity first, as the docs advise.

## Milestone 2, revision 2 — measured outlines (after "not even close")

The first pass fitted a bounding RECTANGLE at each height, which kept the size but threw away the facets.
Now `tools/blueprint/build_blueprint.py` cuts the GLB at a few levels per segment, takes the convex outline of
each cut and simplifies it to its 4–8 dominant corners (low poly, big flat faces). It writes the versioned
blueprint `src/engine/characters/mediumBlueprint.js`, which `createMediumPlayer()` lofts at runtime.
- **Stripes** wrap the real front-outer and back-outer corners of the thigh.
- **Head** stays a generic procedural head (per your direction).
- **Review images:** `analysis/compare/review_body.png` (front, ¾, back, broadcast) and `sheet_detail.png`.

## Milestone 2, revision 3 — shoulder pads, neck, thumbs

- **Shoulder pads:** one block per side from beside the neck (x 0.10) to the arm (x 0.36), y 1.305–1.534.
  Flat front face at z 0.128, bevelled front-top, back-top and outer-top edges, stripe over the top
  (measured with x and y plane sections).
- **Neck:** jersey yoke between the pads sloping back toward the neck, and a U-shaped skin neckline sitting on it.
  The U is measured from the skin colour region: a point at 1.445, ±0.057 at 1.46, ±0.086 at the jaw.
  A back yoke carries the jersey up the back of the neck. The old V-neck and the gap under the yoke are gone.
- **Thumb:** its own outline, cut horizontally (1.292–1.40) and limited to the thumb's x range. It sits on the
  Meshy thumb in the overlay. The palm outline now excludes it, and the white patch on the back of the glove
  follows the palm's sloped top.
- **Triangles:** 1,948.

## Milestone 2, revision 4 — shoulder pad bulk and underside

- The pads are now lofted ACROSS X through measured (y, z) outlines (blueprint `pad`, x 0.19–0.358,
  up to 10 corners). The underside wraps down to y 1.25 next to the chest and 1.28 at the arm, with
  full front-to-back depth (z −0.197 to +0.123). The old pad stopped flat at 1.305 and missed about 5 cm.
- The stripe is cut from the pad's own outline (the part above y 1.40), so it follows the bevels.
- Sleeve cuff kept inside the pad's bevelled outer end (it was poking out at the top).
- Front yoke tucked behind the chest below 1.405 (it formed visible ledges).
- Triangles: 2,004.

## Milestone 2, revision 5 — generic head matched to the Meshy head

- **Head:** a tall rounded rectangle (0.23 wide, 0.30 deep, 0.29 tall) with a flat face plane at z 0.112 and light chamfers.
  The lower face uses trapezoid sections, narrow at the chin and wide at the back of the jaw, as on Meshy.
- **Features (measured on a 4 mm grid of the Meshy face texture):**
  - eyes 0.028 × 0.020 at x ±0.042, y 1.650–1.670
  - thick brows, x 0.008–0.072, y 1.676–1.706, inner end lower
  - nose 1.60–1.70, ±0.025 at the base, tip z 0.145
  - mouth ±0.029 at 1.585
- **Hair:** simple cap hugging the skull, straight hairline at 1.745; back and sides slope from the temple down to the nape at 1.62.

## Milestone 2, revision 6 — head depth

- The back of the head now follows Meshy's side silhouette. Hair is the outer surface (z −0.154 max), and the skull sits about 6 mm inside it.
  Before, the hair was an extra layer behind the skull, which added about 8 mm, and the top-back corner was square.
- Seen from above, every head and hair ring is a tapered octagon, measured from Meshy:
  - face ±0.08
  - widest ±0.11 at the ears
  - back ±0.075

  It used to be a full-width rectangle, which read as a long box.

## Milestone 2, revision 7 — jawline and chin

- The jaw is its own piece, lofted front to back. Its underside rises from the chin (1.533) toward the ear (1.61) with the
  neck visible beneath, as on Meshy. It used to be a flat, full-depth bottom.
- From the front the cheeks drop straight to the jaw corner (1.572, just under the mouth), then turn in to a flat chin
  (±0.058): a U instead of a long V.
- The neck now reaches up into the skull, so nothing shows through behind the jaw.

---

# Milestone 3 — joints and motion (for review)

- **Pose-test viewer:** `tools/poses/index.html`. The new player is driven by the game's own `Animator` through a
  stand-in player object (as in the old `characters/` viewer).
  - Poses: rest, idle, run, sprint, backpedal, shuffle, 3pt, 2pt, wr, block, tackle, catch, throw, fall.
  - `compare=1` puts the current game player beside each one; cameras: front, side, ¾, back, broadcast.
  - `t=` gives deterministic captures.
- **Units:** the player is built in metres; the root is scaled by 1.0936 into the game's yards. The Animator's
  foot planting reads the rig's leg lengths in its own units, so it stays correct.
- **Joint caps:** knee and elbow get an 8-sided prism along the hinge axis, centred on the pivot. It fills the joint
  at any bend and stays hidden when the limb is straight. The skin band at the knee is split at the joint (upper half on
  the thigh, lower on the shin); before, the band's upper half swung out as a wedge when the knee bent.
- **Joint positions:** the inferred landmarks held up in the pose tests. Only change: knee pivot moved to the centre
  of the leg's depth (z −0.045).
- **Shoulder pads:** in the arms-down poses they now sit over the arms (no wings). The arms swing under them in run,
  block, catch and throw.
- **Ground contact** (lowest point over 3 s, `analysis/poses/ground_contact.txt`): matches the current game player
  within 1–3 cm in every pose. Nothing floats; runs leave the ground mid-stride as expected.
- **Known:**
  - In the block pose the forearms come close to the chest front. The current player does the same, because the pose comes from the Animator.
  - Triangles are now 2,176 because of the caps.
  - For game integration (Milestone 7) the rig still needs the `scale` and `dims` fields the engine reads.

---

# Milestone 4 — body variation (for review)

- **`src/engine/characters/bodyMapper.js`** reshapes parts and joints from a resolved body (`Body.resolveBody`, the
  same 16 proportions the game already uses), in the T-pose frame before parts are attached. Joints go through the
  same mapping, so the skeleton always fits the body.
  - **Height** (heightIn = soles to top of head):
    - legs take more of the extra height than the torso (legs ×(1+0.5(f−1)))
    - head ×f^0.2
    - hands and feet ×f^0.4
  - **Widths:** ×√f, then each region from Body.js:
    - hips and glutes, waist and belly (front only), chest, shoulder pads (shoulder_width at the pad edge)
    - neck, upper arm, forearm, thigh, calf
    - the whole leg moves out with the hips
  - **Joint caps:** thickness is held constant across the knee and elbow caps, so they stay round.
  - **No body = identity:** the Meshy comparison is unchanged.
- **Knee simplified:** a single octagonal cap is now the knee (the two overlapping skin bands made spikes on big bodies).
- **Lineup mode:** `tools/poses/index.html?players=POS:heightIn:weightLb:seed,...&pose=...`, with height rulers at 6'0" and 6'6".
- **Gate:**
  - six-player lineup on one ground plane: heights read correctly against the rulers
  - five 6'2" 245 lb linebackers with different seeds
  - ground contact unchanged for all sizes
- **Determinism:**
  - same seed twice gives identical geometry
  - a body saved as JSON rebuilds identically
  - a different seed gives a different player
- **Bulk:** matches the current game player at every size (same Body.js numbers).
  If you want the OT heavier-looking or the WR leaner, the regional exponents in Body.js are the knob,
  and they affect both players the same way.
- **Triangles:** 2,056.

---

# Milestone 5 — faces and portraits (for review)

- **`src/engine/characters/face.js`:** `resolveFace({ seed, skinTone, overrides })` returns a plain, persistable identity
  (with `version`). It uses its own random stream from the seed, so body and face are independent.
  - **Skin tone:** the game's 7 tones.
  - **Hair colour:** loosely tied to skin tone (black, brown range, blond, red, grey).
  - **Hair style:** short (the measured Meshy cut), buzz, flattop, curly or bald.
  - **Beard:** none, stubble, goatee, moustache or full.
  - **13 shape controls with narrow ranges:**
    - head width and length, jaw width, chin
    - brow height, tilt and thickness
    - eye spacing and size
    - nose width and length, mouth width, ear size
  - `DEFAULT_FACE` is the measured head, so the Meshy comparison is unchanged.
- **Head builder:** takes the face. Hair stays its own mesh (hidden under a helmet). Beards are on the head
  (visible through a facemask).
- **`src/engine/characters/portrait.js`:** `renderPortrait(renderer, rig, { size, angle })`. Fixed head-and-shoulders
  camera and studio lighting, rest pose, rendered offscreen and returned as a canvas for player cards.
- **`tools/portraits/index.html?n=50`:** portrait grid.
- **Gate:**
  - 50 identities, all different
  - rebuilt from saved JSON: identical
  - identical after a page reload
- **Arms:** the elbow cap's corners poked out past the forearm's bevels (dark notches at the elbows). The cap is now
  smaller and stays inside the arm's outline; the knee cap's ends were trimmed the same way.
- **Note:** a dark moustache on the darkest skin tones barely shows. Fine as is, or give facial hair a minimum contrast.

## Arms and shoulder pads clean-up (during Milestone 5)

- **Z-fighting slits (elbow, wrist, palm/fingers):** neighbouring segments shared identical outlines, so their side faces
  coincided. Bands (wristband, sock band) now sit 2 mm proud; a segment that starts inside its neighbour shrinks
  its first outline 3–4 % (forearm, fingers).
- **Glove patch:** cut from the palm's actual top surface (it floated above the bevelled outline).
- **Shoulder "wings" with the arms down:** the old sleeve cuff was a box on the shoulder joint that swung out from under
  the pad. Replaced by a rounded jersey nub centred on the joint (same from every angle).
- **Pad / chest seams:** the pad's inner section is tucked inside the chest. The front yoke is laid 1.5 mm in front of
  the chest's measured front up to the neckline, so chest, yoke and neckline read as one surface.
- **Triangles:** 2,180.

---

# Milestone 6 — exact helmet integration (for review)

- **`tools/blueprint/build_helmet.py`** → `assets/characters/helmet_regions.glb` (58 KB; the source is 3.8 MB).
  Geometry is copied exactly: the script checks that every source triangle is present once, with identical vertices and UVs.
  Approved material changes only:
  - **Matte:** the material was metallic 1.0.
  - **Region map:** the three 2048² textures became one 512² map of the painted colours (shell / stripe / inner, seam speckles cleaned), so painted edges stay exactly where Meshy put them.
  - **Mask:** the white facemask bars (same paint as the shell) are split off by geometry, so they get their own team colour.
- **`src/engine/characters/helmet.js`:**
  - `loadHelmet()` loads once; the geometry is shared by all players.
  - `attachHelmet(rig, asset, kit)` mounts on the head bone and hides the hair.
  - `setHelmet(rig, on)` switches the helmet off for the sideline and portraits.
  - Team materials are cached per colour set: shell = `kit.helmet`, stripe = `kit.helmetStripe`, mask = `kit.mask`, interior dark.
- **Fit (rigid only):** uniform scale 0.455, centred at (0, 1.6685, 0) in the Meshy frame. It follows each body's head
  scale. This is the smallest fit with no head vertex outside the shell; the Meshy dome is slightly asymmetric, so
  0.45 let a skull corner through on the left for long or wide heads.
- **Penetration test:** rays from every head and beard vertex inside the helmet go out to the sides, up and back (the
  front and bottom are the helmet's real openings). Across 200 players (all six lineup sizes, all hair and beard
  types, the extremes of the face ranges), 177,230 vertices were checked and none were outside. The helmet is
  rigid on the head bone, so the result holds in every pose.
- **Visor:** the Meshy helmet has no separate visor (the facemask and visor slot are one fused mesh), so there is no visor toggle,
  as the docs require. A visor would need its own asset.
- **Viewer:** `tools/poses/index.html` takes `helmet=1`, `faces=1`, and team colours `primary=`, `secondary=`, `helmetc=`, `mask=`.

---

# Milestone 7 — game integration (for review)

- **`src/engine/characters/gamePlayer.js`:** `createGameRig()`, a drop-in for `createPlayerRig` with the same interface
  (root / tilt / yaw / 17 bones / leg / scale / dims / meshes / decals).
  - **Units:** metres → yards sits on `tilt`, so world positions and baked bench geometry are in yards.
  - **Face:** from the player's seed with the skin tone the game picked.
  - **Numbers / names:** decals lie on the chest's measured front and back slopes.
  - **Helmet:** attached when its 58 KB file arrives.
- **Switch:**
  - `FootballEngine({ playerModel: 'meshy' | 'classic' })`, default `'meshy'`; `?classic` in the URL brings back the previous players.
  - `Player.js` and the bench builder in `Stadium.js` choose the builder (benches: helmets off).
  - The number-decal canvas is shared (`PlayerModel.numberDecalMaterial`).
- **No other engine code changed:** Animator, Physics, Ball and Engine logic are untouched.
- **Profile** (SwiftShader, same scene, 22 players; times only meaningful relative to each other):

  | | meshy | classic |
  |---|---|---|
  | draw calls per frame (incl. shadows) | 922 | 834 |
  | triangles per frame | 1.40 M | 1.14 M |
  | player triangles | 67,488 (~3,070 each incl. helmet) | 17,908 |
  | player animation cost per frame | 0.15 ms | 0.12 ms |
  | render | 3.3 ms | 4.1 ms |
  | 180 s of simulation (no render) | 5.8 s | 4.9–5.4 s |

  No LOD needed on this evidence. Most triangles are the stadium and crowd.
- **Stress run:** 180 s of game time with snaps, throws, catches, deflections, handoffs, hits, falls and downs; no errors.
- **Gameplay coupling:**
  - The sim reads two things from the rig. `rig.scale` (catch reach) is identical for every body.
  - The right-hand bone is the throw origin and the carried-ball anchor. It sits 3–4 in from the classic position at rest or carrying, and 8–9 in at release.
    Throws are aimed from that origin, so they still arrive at the intended target; only the start point of the flight moves.
  - For strict parity the throw origin could come from a model-independent point (classic arm lengths).
    That's a small change in `Ball.js`, not done without your OK.
