// ---------------------------------------------------------------------------
// Milestone 5: procedural faces.
//
//   resolveFace({ seed, overrides })  → a plain, persistable identity object
//
// The face is separate from the body: its own random stream from the same seed, so changing a
// player's weight never changes his face, and a trade (new uniform) changes neither.
// Store the RESOLVED object (not just the seed) so future generator changes don't alter
// existing players; `version` records which rules produced it.
//
// DEFAULT_FACE reproduces the measured medium head exactly (used by the Meshy comparison).
// ---------------------------------------------------------------------------
import { rng } from '../Body.js';
import { SKIN_TONES } from '../constants.js';

export const FACE_VERSION = 1;

export const HAIR_STYLES = ['short', 'buzz', 'flattop', 'curly', 'bald'];
export const BEARDS = ['none', 'stubble', 'goatee', 'moustache', 'full'];
export const HAIR_COLOURS = ['#1b1210', '#2e1518', '#4a2c1c', '#6b4429', '#9c6b3c', '#c9a063', '#8f3b1f', '#8a8580'];
// (black, near-black, dark brown, brown, light brown, blond, red, grey)

/** Shape controls: 1 / 0 = the measured medium head. Ranges kept narrow so every face stays in the art style. */
export const FACE_SHAPE_RANGES = {
  headWidth: [0.94, 1.06], headLength: [0.96, 1.04], jawWidth: [0.88, 1.12], chin: [-1, 1],
  browHeight: [-1, 1], browTilt: [-1, 1], browThick: [0.7, 1.2], eyeSpacing: [0.9, 1.1], eyeSize: [0.85, 1.15],
  noseWidth: [0.8, 1.25], noseLength: [0.85, 1.15], mouthWidth: [0.8, 1.2], earSize: [0.85, 1.2],
};

export const DEFAULT_FACE = Object.freeze({
  version: FACE_VERSION, seed: null,
  skinTone: null, skin: '#ffaf68', hairStyle: 'short', hairColour: '#2e1518', beard: 'none',
  shape: Object.freeze(Object.fromEntries(Object.keys(FACE_SHAPE_RANGES).map(k => [k, ['chin', 'browHeight', 'browTilt'].includes(k) ? 0 : 1]))),
});

const pick = (rand, items, weights) => {
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
};

/**
 * @param {object} o
 *  seed       integer (same seed → same face)
 *  skinTone   index into SKIN_TONES (rolled if omitted)
 *  overrides  { hairStyle, hairColour, beard, shape: {...} }
 */
export function resolveFace(o = {}) {
  const seed = o.seed ?? ((Math.random() * 2 ** 31) | 0);
  const rand = rng((seed ^ 0x5f3759df) >>> 0);           // independent of the body's random stream
  const skinTone = o.skinTone ?? Math.floor(rand() * SKIN_TONES.length);
  const dark = skinTone / (SKIN_TONES.length - 1);         // 0 = lightest … 1 = darkest
  // hair colour: darker skin → mostly black / near-black; lighter skin → the full range
  const hairColour = pick(rand, HAIR_COLOURS, [
    1 + 3 * dark, 2 + 2 * dark, 2, 1.6 * (1 - dark), 1.2 * (1 - dark), 0.9 * (1 - dark) ** 2, 0.4 * (1 - dark) ** 2, 0.25,
  ]);
  const hairStyle = pick(rand, HAIR_STYLES, [3.5, 2.5, 1.2, 1.5 + 2 * dark, 0.8]);
  const beard = pick(rand, BEARDS, [4.5, 2.5, 1.2, 0.6, 1.2]);
  const shape = {};
  for (const [k, [a, b]] of Object.entries(FACE_SHAPE_RANGES)) {
    const t = (rand() + rand()) / 2;                        // triangular: most faces near the middle
    shape[k] = +(a + (b - a) * t).toFixed(3);
  }
  const face = { version: FACE_VERSION, seed, skinTone, skin: SKIN_TONES[skinTone], hairStyle, hairColour, beard, shape };
  const ov = o.overrides || {};
  return { ...face, ...ov, shape: { ...face.shape, ...(ov.shape || {}) } };
}

/** Colours for the head builder from a face. */
export function faceLook(face) {
  const mix = (a, b, t) => {
    const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  const isDefault = face === DEFAULT_FACE;
  return {
    skin: face.skin,
    hair: face.hairColour,
    brows: isDefault ? '#4b3122' : mix(face.hairColour, '#000000', 0.15),
    eyes: '#2e1518',
    mouth: isDefault ? '#b9764a' : mix(face.skin, '#5a2a1a', 0.35),
    stubble: mix(face.skin, face.hairColour, 0.45),
  };
}
