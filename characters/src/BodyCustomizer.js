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

/** Returns a reshaped copy of the base geometry's positions (geometry is not modified). */
export function reshape(baseGeometry, body) {
  const B = BASE, S = bodyScales(body);
  const src = baseGeometry.attributes.position;
  const out = new Float32Array(src.count * 3);
  const mapY = (y) => (y <= B.hipY ? y * S.legK : S.hipY + (y - B.hipY) * S.torsoK);
  for (let i = 0; i < src.count; i++) {
    let x = src.getX(i), y = src.getY(i), z = src.getZ(i);
    const ax = Math.abs(x), sx = Math.sign(x) || 1;
    if (y >= B.neckY && ax < B.helmetX) {
      // helmet: rigid, moved up with the neck
      y += S.neckY - B.neckY;
    } else if (ax > B.armX && y > 1.1) {
      // arm (T-pose, along x): root follows the shoulders, length and thickness scale
      const t = smooth(B.armX + 0.05, 0.68, ax);                    // upper arm → forearm
      const thick = lerp(S.upperArm, S.forearm, t);
      const rootX = B.armX * S.shoulders;
      x = sx * (rootX + (ax - B.armX) * S.armLen);
      const newArmY = mapY(B.armY);
      y = newArmY + (y - B.armY) * thick;
      z *= thick;
    } else {
      // torso and legs: width blends by height between region parameters
      let wx, wz;
      if (y >= B.chestY) { const t = smooth(B.chestY, B.shoulderY, y); wx = lerp(S.chest, S.shoulders, t); wz = S.chestD; }
      else if (y >= B.waistY) { const t = smooth(B.waistY, B.chestY, y); wx = lerp(S.waist, S.chest, t); wz = lerp(S.waistD, S.chestD, t); }
      else if (y >= B.hipY - 0.1) { const t = smooth(B.hipY - 0.1, B.waistY, y); wx = lerp(S.hips, S.waist, t); wz = lerp(S.glutes, S.waistD, t); }
      else {
        // legs: thickness scales around each leg's own axis, stance follows the hips
        const t = smooth(0.12, 0.6, y);
        const k = lerp(S.calf, S.thigh, t);
        const cx = B.legX * S.hips;
        x = sx * (cx + (ax - B.legX) * k);
        z *= k;
        y = mapY(y);
        out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
        continue;
      }
      if (y > B.neckY - 0.08 && ax < B.helmetX) { const t = smooth(B.neckY - 0.08, B.neckY, y); wx = lerp(wx, S.neck, t); wz = lerp(wz, S.neck, t); }
      x *= wx; z *= wz;
      y = mapY(y);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
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
