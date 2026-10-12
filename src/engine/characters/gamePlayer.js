import { createMediumPlayer } from './mediumPlayer.js';
import { resolveFace } from './face.js';
import { loadHelmet, attachHelmet } from './helmet.js';
import { SKIN_TONES } from '../constants.js';
import { REF } from '../Body.js';

// ---------------------------------------------------------------------------
// Milestone 7: the character-system player as a drop-in for PlayerModel.createPlayerRig.
//
// Same contract the engine reads: root / tilt / yaw / bones (17, same names and conventions),
// leg { HIP_Y, THIGH, SHIN, FOOT_H } for foot planting, scale (height vs the 6'1" reference: catch
// reach), dims.Hy, meshes + decals (disposeRig, bakeRig).
//
// Units: the character is built in metres; the metres → yards factor sits on `tilt`, so `root`
// stays unscaled at the player's yard position, and world positions / baked bench geometry are in
// yards. The Animator works in the rig's own units below `tilt`, so foot planting is unaffected.
//
// The helmet (58 KB) loads once on first use and is attached as soon as it arrives.
// ---------------------------------------------------------------------------

export const M_TO_YD = 1.0936;
const REF_HEIGHT_YD = REF.heightIn / 36;

let helmetPromise = null;
/** Start loading shared assets early (optional; first createGameRig does it anyway). */
export function preloadPlayerAssets() { return (helmetPromise ||= loadHelmet()); }

/**
 * @param {object} o  same as createPlayerRig: body, kit (Uniforms.resolveKit), skin, number, name
 *   helmet  true (default) = helmet on (attached when loaded); false = bareheaded (benches, cards)
 *   face    a saved face (face.js); default: resolved from the body's seed with this skin tone
 */
export function createGameRig({ body, kit, skin, number = null, name = null, helmet = true, face = null }) {
  const skinTone = Math.max(0, SKIN_TONES.indexOf(skin));
  const f = face || resolveFace({ seed: body.seed, skinTone });
  const rig = createMediumPlayer({
    body, face: f, number, name,
    kit: { ...kit, gloveTrim: kit.trim, studs: '#d8dadf' },
  });
  rig.tilt.scale.setScalar(M_TO_YD);
  const heightYd = rig.heightM * M_TO_YD;
  rig.scale = heightYd / REF_HEIGHT_YD;
  rig.dims = { Hy: heightYd };
  rig.kit = kit;
  if (helmet) {
    preloadPlayerAssets().then(asset => { if (!rig.disposed) attachHelmet(rig, asset, kit); });
  }
  return rig;
}
