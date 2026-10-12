// ---------------------------------------------------------------------------
// Milestone 4: body variation for the medium player.
//
//   const M = bodyMapper(body)        // body = Body.resolveBody(...) or undefined (= the measured medium player)
//   M.point(x, y, z, region)          // T-pose world point (metres) → reshaped point
//
// Parts and joints are authored in the Meshy T-pose frame (metres, floor 0, +Z front, +X player's left).
// The mapper reshapes them BEFORE they are attached to joints, and joints go through the same mapping,
// so the skeleton always fits the body. Same rules as the current engine (PlayerModel.bodyDims):
//  - height: legs take more of extra height than the torso; the head barely scales (f^0.2), hands/feet modestly (f^0.4)
//  - widths follow height mildly (sqrt f) times the per-region values from Body.js (chest, waist, hips, pads,
//    neck, upper arm, forearm, thigh, calf, glutes, belly)
// With no body the mapping is the identity, so the Meshy comparison stays exact.
//
// Regions (picked from the joint a part hangs on): 'leg', 'torso', 'neck', 'head', 'arm'.
// ---------------------------------------------------------------------------

const BASE = {
  height: 1.82,                         // measured: soles to top of hair
  hipY: 0.90, collarY: 1.534,           // leg / torso / head boundaries
  legJ: [[0.90, 0.105, -0.02], [0.52, 0.14, -0.045], [0.11, 0.165, -0.05]],   // [y, |x|, z] hip, knee, ankle
  shoulderX: 0.30, elbowX: 0.465, wristX: 0.665, armY: 1.366, armZ: -0.03,
  torsoZ: -0.035, headPivot: [0, 1.534, -0.02],
};
const REF_IN = 73;                      // Body.js reference height (inches) = the medium player
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** piecewise-linear lookup in [[y, v], ...] sorted by y */
function pw(keys, y) {
  if (y <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (y <= keys[i][0]) {
    const [y0, v0] = keys[i - 1], [y1, v1] = keys[i];
    return lerp(v0, v1, (y - y0) / (y1 - y0));
  }
  return keys[keys.length - 1][1];
}

export function bodyMapper(body) {
  if (!body) return { point: (x, y, z) => [x, y, z], identity: true, heightM: BASE.height, headScale: 1 };
  const P = body.p;
  const f = body.heightIn / REF_IN;
  const fw = Math.sqrt(f);                          // widths follow height mildly
  const hs = Math.pow(f, 0.2);                      // head: barely
  const hf = Math.pow(f, 0.4);                      // hands and feet: modestly
  const H = body.heightIn * 0.0254;                 // soles to top of head (metres)

  // vertical chain: legs take more of the extra height than the torso
  const L0 = BASE.hipY, T0 = BASE.collarY - BASE.hipY, H0 = BASE.height - BASE.collarY;
  const legRaw = L0 * P.leg_length * (1 + 0.5 * (f - 1)), torsoRaw = T0 * P.torso_length;
  const k = (H - H0 * hs) / (legRaw + torsoRaw);
  const kL = k * P.leg_length * (1 + 0.5 * (f - 1)), kT = k * P.torso_length;
  const Y = (y) => (y <= BASE.hipY ? y * kL : y <= BASE.collarY ? L0 * kL + (y - L0) * kT : L0 * kL + T0 * kT + (y - BASE.collarY) * hs);

  // torso widths by height (x about 0, z about the torso centre line); belly pushes the front out
  const wx = (y) => fw * pw([[0.84, P.hip_width], [0.99, P.hip_width], [1.06, P.waist_width], [1.24, P.chest_width]], y);
  const wz = (y) => fw * pw([[0.84, P.glute_size], [0.99, P.glute_size], [1.06, P.waist_depth * Math.sqrt(P.abdomen_size)], [1.24, P.chest_depth]], y);
  const belly = (y) => 1 + 0.6 * (P.abdomen_size - 1) * clamp01(1 - Math.abs(y - 1.06) / 0.14);
  // pads: inside |x| 0.19 follow the chest, beyond it stretch so the pad edge (0.36) lands at shoulder_width
  const CH = 0.19, PAD = 0.36;
  // blended in over y 1.18..1.27 so the pad's underside never gets a step (it reaches down to 1.25)
  const torsoX = (ax, y) => {
    const c = wx(y);
    if (ax <= CH) return ax * c;
    const sw = fw * P.shoulder_width;
    const padX = CH * c + (ax - CH) * (PAD * sw - CH * c) / (PAD - CH);
    return lerp(ax * c, padX, clamp01((y - 1.18) / 0.09));
  };

  // legs: whole leg shifts out with the hips; thickness about the leg's centre line
  const hipShift = BASE.legJ[0][1] * (fw * P.hip_width - 1);
  const legC = (y) => [pw(BASE.legJ.map(([yy, x]) => [yy, x]).reverse(), y), pw(BASE.legJ.map(([yy, , z]) => [yy, z]).reverse(), y)];
  // thickness is held constant across the knee (0.43..0.61, the knee cap's span) so the round cap stays round
  const kneeT = (P.calf_thickness + P.thigh_thickness) / 2;
  const legT = (y) => (y < 0.20 ? hf * (0.9 + 0.1 * P.calf_thickness)
    : fw * pw([[0.36, P.calf_thickness], [0.43, kneeT], [0.61, kneeT], [0.68, P.thigh_thickness]], y));

  // arms (T-pose along ±X): shoulder rides on the pad edge, length and thickness per segment, hand modest
  const shX = torsoX(BASE.shoulderX, BASE.armY);
  const armS = k * P.arm_length * (1 + 0.3 * (f - 1)) / (1 + 0.0);   // follows overall scale + arm length
  const elX = shX + (BASE.elbowX - BASE.shoulderX) * armS;
  const wrX = shX + (BASE.wristX - BASE.shoulderX) * armS;
  // same at the elbow: constant thickness over the elbow cap's span (±0.085)
  const elbowT = (P.upper_arm_thickness + P.forearm_thickness) / 2;
  const armT = (x) => fw * pw([[BASE.elbowX - 0.12, P.upper_arm_thickness], [BASE.elbowX - 0.085, elbowT],
    [BASE.elbowX + 0.085, elbowT], [BASE.elbowX + 0.12, P.forearm_thickness]], x);

  const point = (x, y, z, region) => {
    const s = x < 0 ? -1 : 1, ax = Math.abs(x);
    switch (region) {
      case 'leg': {
        const [cx, cz] = legC(y), t = legT(y);
        return [s * (cx + hipShift + (ax - cx) * t), Y(y), cz + (z - cz) * t];
      }
      case 'arm': {
        const yy = Y(BASE.armY), zz = BASE.armZ;
        if (ax >= BASE.wristX) {                     // hand: modest uniform scale about the wrist
          return [s * (wrX + (ax - BASE.wristX) * hf), yy + (y - BASE.armY) * hf, zz + (z - zz) * hf];
        }
        const t = armT(ax);
        return [s * (shX + (ax - BASE.shoulderX) * armS), yy + (y - BASE.armY) * t, zz + (z - zz) * t];
      }
      case 'neck':
        if (y > BASE.collarY) return point(x, y, z, 'head');
        return [x * fw * P.neck_thickness, Y(y), BASE.torsoZ + (z - BASE.torsoZ) * fw * P.neck_thickness];
      case 'head': {
        const [px, py, pz] = BASE.headPivot;
        return [px + (x - px) * hs, Y(BASE.collarY) + (y - py) * hs, pz + (z - pz) * hs];
      }
      default: {                                     // torso, pads, pelvis
        const zc = BASE.torsoZ;
        let sz = wz(y);
        if (z > zc) sz *= belly(y);
        return [s * torsoX(ax, y), Y(y), zc + (z - zc) * sz];
      }
    }
  };
  return { point, identity: false, heightM: H, headScale: hs };
}

/** Region of a joint's parts. */
export function jointRegion(name) {
  if (/^(hip|kn|ank)/.test(name)) return 'leg';
  if (/^(sh|el|hand)/.test(name)) return 'arm';
  if (name === 'neck') return 'neck';
  if (name === 'head') return 'head';
  return 'torso';
}
