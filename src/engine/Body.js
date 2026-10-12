// ---------------------------------------------------------------------------
// Procedural body resolution.
//
//   resolveBody({ seed, position, heightIn, weightLb, archetype, overrides })
//     → { seed, position, archetype, heightIn, weightLb, p: { ...proportions } }
//
// Height and weight come from the sim; if missing they are rolled from the
// position's typical distribution. Proportion values are normalised: 1.0 is the
// medium reference player (6'1", 225 lb, "balanced athletic").
//
// Weight is NOT a uniform scale. Each region responds to mass with its own
// exponent (waists and bellies grow faster than shoulders), archetypes bias
// the regions, and the seed adds bounded per-player variation. The result is
// a plain object: store it and the player can be rebuilt exactly, independent
// of future changes to this file.
// ---------------------------------------------------------------------------

export const REF = { heightIn: 73, weightLb: 225 };

export const PARAMS = [
  'shoulder_width', 'chest_width', 'chest_depth', 'waist_width', 'waist_depth', 'hip_width',
  'torso_length', 'leg_length', 'arm_length', 'neck_thickness',
  'upper_arm_thickness', 'forearm_thickness', 'thigh_thickness', 'calf_thickness', 'glute_size', 'abdomen_size',
];

// How strongly each region responds to relative mass (BMI ratio vs. reference).
const MASS_EXP = {
  shoulder_width: 0.35, chest_width: 0.45, chest_depth: 0.55, waist_width: 0.7, waist_depth: 0.8, hip_width: 0.5,
  neck_thickness: 0.55, upper_arm_thickness: 0.55, forearm_thickness: 0.45, thigh_thickness: 0.55,
  calf_thickness: 0.45, glute_size: 0.6, abdomen_size: 1.0,
};

// Archetypes: typical size (for rolling missing values), regional bias, variation.
export const ARCHETYPES = {
  compact: {
    heightIn: [70, 1.5], weightLb: [212, 10], sd: 0.025,
    bias: { leg_length: 0.97, torso_length: 1.0, thigh_thickness: 1.08, calf_thickness: 1.05, glute_size: 1.06, shoulder_width: 0.98 },
  },
  lean_athletic: {
    heightIn: [72.5, 2], weightLb: [198, 10], sd: 0.025,
    bias: { leg_length: 1.03, arm_length: 1.02, waist_width: 0.94, waist_depth: 0.94, abdomen_size: 0.9, upper_arm_thickness: 0.95 },
  },
  balanced_athletic: {
    heightIn: [74, 1.8], weightLb: [218, 10], sd: 0.025,
    bias: {},
  },
  strong_athletic: {
    heightIn: [74.5, 1.5], weightLb: [245, 10], sd: 0.03,
    bias: { shoulder_width: 1.05, chest_width: 1.04, chest_depth: 1.04, upper_arm_thickness: 1.06, waist_width: 0.97, thigh_thickness: 1.04 },
  },
  power: {
    heightIn: [75.5, 1.5], weightLb: [272, 12], sd: 0.03,
    bias: { shoulder_width: 1.04, chest_depth: 1.05, upper_arm_thickness: 1.05, forearm_thickness: 1.05, thigh_thickness: 1.05 },
  },
  massive: {
    heightIn: [76.5, 1.5], weightLb: [312, 14], sd: 0.03,
    bias: { abdomen_size: 1.08, waist_width: 1.04, waist_depth: 1.05, glute_size: 1.05, leg_length: 0.97, neck_thickness: 1.05 },
  },
};

export const POSITION_ARCHETYPE = {
  QB: 'balanced_athletic', RB: 'compact', FB: 'power', WR: 'lean_athletic', TE: 'strong_athletic',
  OL: 'massive', OT: 'massive', OG: 'massive', C: 'massive',
  DL: 'massive', DT: 'massive', DE: 'power', LB: 'strong_athletic',
  CB: 'lean_athletic', S: 'balanced_athletic', K: 'balanced_athletic', P: 'balanced_athletic',
};

// Trait loadings per parameter (see resolveBody). Lengths trade off against each other.
const TRAIT_SD = 0.06;
const TRAITS = {
  shoulder_width: { upper: 1 }, chest_width: { upper: 0.9 }, chest_depth: { upper: 0.7, core: 0.3 },
  upper_arm_thickness: { upper: 1 }, forearm_thickness: { upper: 0.7 }, neck_thickness: { upper: 0.6 },
  hip_width: { lower: 0.8 }, thigh_thickness: { lower: 1 }, calf_thickness: { lower: 0.8 }, glute_size: { lower: 0.8, core: 0.2 },
  waist_width: { core: 0.9 }, waist_depth: { core: 1 }, abdomen_size: { core: 1.2 },
  leg_length: { legs: 0.5 }, torso_length: { legs: -0.45 }, arm_length: { legs: 0.25 },
};

/** Deterministic PRNG (mulberry32). Returns () => [0, 1). */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform PRNG, clamped to ±2.5σ so nobody is extreme. */
export function gauss(rand) {
  const u = Math.max(rand(), 1e-9), v = rand();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-2.5, Math.min(2.5, g));
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * @param {object} o
 *  seed       integer (random if omitted, but then not reproducible)
 *  position   'QB' | 'RB' | ... (picks the archetype if none given)
 *  heightIn   standing height incl. helmet, inches (rolled if omitted)
 *  weightLb   pounds (rolled if omitted)
 *  archetype  key of ARCHETYPES, or null for no preset bias
 *  overrides  { param: value } explicit proportion overrides
 */
export function resolveBody(o = {}) {
  const seed = o.seed ?? ((Math.random() * 2 ** 31) | 0);
  const rand = rng(seed);
  const archetype = o.archetype !== undefined ? o.archetype : (POSITION_ARCHETYPE[o.position] || 'balanced_athletic');
  const A = ARCHETYPES[archetype] || { heightIn: [73, 2], weightLb: [225, 15], sd: 0.025, bias: {} };

  // draw the size randoms first so proportions don't shift when sizes are given
  const gH = gauss(rand), gW = gauss(rand);
  const heightIn = clamp(o.heightIn ?? A.heightIn[0] + gH * A.heightIn[1], 67, 81);
  const weightLb = clamp(o.weightLb ?? A.weightLb[0] + gW * A.weightLb[1], 160, 380);

  const frame = heightIn / REF.heightIn;
  const bulk = (weightLb / REF.weightLb) / (frame * frame); // BMI ratio
  // correlated traits make players of the same size look different in a
  // coherent way (top-heavy vs. leg-heavy, thick vs. lean core, long legs vs. long torso)
  const trait = { upper: gauss(rand), lower: gauss(rand), core: gauss(rand), legs: gauss(rand) };
  const p = {};
  for (const k of PARAMS) {
    const g = gauss(rand);
    let v;
    if (k === 'leg_length' || k === 'torso_length' || k === 'arm_length') v = 1;     // lengths: relative share
    else v = Math.pow(bulk, MASS_EXP[k]);                                             // widths: from mass
    v *= A.bias[k] ?? 1;
    let t = 0;
    for (const [name, w] of Object.entries(TRAITS[k] || {})) t += trait[name] * w;
    v *= Math.exp(t * TRAIT_SD + g * A.sd);
    p[k] = +v.toFixed(4);
  }
  Object.assign(p, o.overrides || {});
  return { seed, position: o.position || null, archetype, heightIn: +heightIn.toFixed(2), weightLb: +weightLb.toFixed(1), p };
}
