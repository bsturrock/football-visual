import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Landmark-based body reshaping for the base-medium mesh (T-pose, metres,
// y up, +z forward, feet at y = 0, 6'1").
//
// The mesh is split into regions by simple landmarks (helmet, torso, arms,
// hips/legs). Height stretches legs and torso; the helmet is only moved up,
// never scaled. Weight/build widen each region by its own body parameter
// (from Body.resolveBody, 1.0 = the base player). All mappings are continuous
// in y so neighbouring regions stay connected.
//
// The same landmarks will drive the skeleton joints in Milestone 2/3, so mesh
// and rig stay aligned.
// ---------------------------------------------------------------------------

export const BASE = {
  height: 1.854,
  neckY: 1.47,      // helmet / chin bottom: helmet (|x| < helmetX) above this keeps its size
  helmetX: 0.25,
  shoulderY: 1.45,  // shoulder pad height
  chestY: 1.20,
  waistY: 0.98,     // jersey hem
  hipY: 0.90,       // hip joints
  armX: 0.40,       // shoulder pad edge: |x| beyond this (above 1.1 m) is arm
  armY: 1.35,       // arm axis height in the T-pose
  legX: 0.135,      // leg axis |x|
};

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Region scale factors and new landmark heights for a resolved body. */
export function bodyScales(body) {
  const P = body.p, B = BASE;
  const Ht = body.heightIn * 0.0254;
  const helmet = B.height - B.neckY;
  // body below the neck absorbs the height change; legs take a bigger share
  const s = (Ht - helmet) / B.neckY;
  const legK = (1 + 1.2 * (s - 1)) * P.leg_length;
  const legsNew = B.hipY * legK;
  const torsoK = (Ht - helmet - legsNew) / (B.neckY - B.hipY);
  const fw = Math.sqrt(Ht / B.height); // widths follow height mildly
  return {
    Ht, legK, torsoK,
    hipY: legsNew, neckY: Ht - helmet,
    shoulders: P.shoulder_width * fw,
    chest: P.chest_width * fw, chestD: P.chest_depth * fw,
    waist: P.waist_width * fw, waistD: P.waist_depth * Math.sqrt(P.abdomen_size) * fw,
    hips: P.hip_width * fw, glutes: P.glute_size * fw,
    thigh: P.thigh_thickness * fw, calf: P.calf_thickness * fw,
    upperArm: P.upper_arm_thickness * fw, forearm: P.forearm_thickness * fw,
    armLen: P.arm_length * Math.sqrt(s),
    neck: P.neck_thickness,
  };
}

/**
 * Map one point of the base player (T-pose, metres) into the reshaped body.
 * Used for mesh vertices and skeleton joints alike, so the rig stays aligned.
 */
export function mapPoint(S, x, y, z, out) {
  const B = BASE;
  const ax = Math.abs(x), sx = Math.sign(x) || 1;
  const mapY = (v) => (v <= B.hipY ? v * S.legK : S.hipY + (v - B.hipY) * S.torsoK);
  if (y >= B.neckY && ax < B.helmetX) {
    // helmet: rigid, moved up with the neck
    return out.set(x, y + S.neckY - B.neckY, z);
  }
  if (ax > B.armX && y > 1.1) {
    // arm (T-pose, along x): root follows the shoulders, length and thickness scale
    const t = smooth(B.armX + 0.05, 0.68, ax);
    const thick = lerp(S.upperArm, S.forearm, t);
    return out.set(sx * (B.armX * S.shoulders + (ax - B.armX) * S.armLen), mapY(B.armY) + (y - B.armY) * thick, z * thick);
  }
  if (y < B.hipY - 0.1) {
    // legs: thickness scales around each leg's own axis, stance follows the hips
    const k = lerp(S.calf, S.thigh, smooth(0.12, 0.6, y));
    return out.set(sx * (B.legX * S.hips + (ax - B.legX) * k), mapY(y), z * k);
  }
  // torso: width blends by height between region parameters
  let wx, wz;
  if (y >= B.chestY) { const t = smooth(B.chestY, B.shoulderY, y); wx = lerp(S.chest, S.shoulders, t); wz = S.chestD; }
  else if (y >= B.waistY) { const t = smooth(B.waistY, B.chestY, y); wx = lerp(S.waist, S.chest, t); wz = lerp(S.waistD, S.chestD, t); }
  else { const t = smooth(B.hipY - 0.1, B.waistY, y); wx = lerp(S.hips, S.waist, t); wz = lerp(S.glutes, S.waistD, t); }
  if (y > B.neckY - 0.08 && ax < B.helmetX) { const t = smooth(B.neckY - 0.08, B.neckY, y); wx = lerp(wx, S.neck, t); wz = lerp(wz, S.neck, t); }
  return out.set(x * wx, mapY(y), z * wz);
}

/** Reshaped copy of the base geometry (all other attributes, incl. skin weights, are kept). */
export function reshape(baseGeometry, body, S = bodyScales(body)) {
  const src = baseGeometry.attributes.position;
  const out = new Float32Array(src.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    mapPoint(S, src.getX(i), src.getY(i), src.getZ(i), v);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  const g = baseGeometry.clone();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------------------
// Skin tone: recolour skin texels of the base texture (cached per tone).
// ---------------------------------------------------------------------------
const toneCache = new Map();
let classified = null;

function classify(image) {
  const w = image.width, h = image.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const skin = new Uint8Array(w * h);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const s = max ? (max - min) / max : 0;
    if (max === r && r > b + 30 && g > b && s > 0.2 && max > 80) { skin[i] = 1; sr += r; sg += g; sb += b; n++; }
  }
  return { w, h, data, skin, ref: [sr / n, sg / n, sb / n] };
}

/** Texture with skin recoloured to a CSS colour (null = original). */
export function skinTexture(baseTexture, tone) {
  if (!tone) return baseTexture;
  if (toneCache.has(tone)) return toneCache.get(tone);
  classified ||= classify(baseTexture.image);
  const { w, h, data, skin, ref } = classified;
  const rgb = new THREE.Color(tone).getRGB({}, THREE.SRGBColorSpace);
  const target = [rgb.r * 255, rgb.g * 255, rgb.b * 255];
  const out = new Uint8ClampedArray(data.data);
  for (let i = 0; i < w * h; i++) {
    if (!skin[i]) continue;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = target[k] * (data.data[i * 4 + k] / ref[k]);
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = baseTexture.flipY;
  toneCache.set(tone, tex);
  return tex;
}
