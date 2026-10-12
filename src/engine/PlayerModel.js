import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { REF } from './Body.js';

// ---------------------------------------------------------------------------
// Procedural boxy player, built in code from a resolved body (Body.js) and a
// uniform (Uniforms.js). Units are yards; the rig faces +Z, +X is the
// player's left.
//
// Every limb segment is a few flat-shaded boxes rigidly attached to its joint
// (no skinning), merged into ONE vertex-coloured mesh per joint. Rigid boxy
// segments keep clean edges in any pose — nothing stretches or warps.
//
// Hierarchy (unchanged, the Animator drives these joints):
//   root (feet)
//    └ tilt (lean / fall, pivot at the feet)
//       └ yaw (facing)
//          └ pelvis (height solved from leg angles every frame)
//             ├ hipL/R → knL/R → ankL/R
//             └ spine → chest → neck → head
//                         ├ shL → elL → handL
//                         └ shR → elR → handR
// Joint sign conventions (rotation.x): hip −=flex forward, knee +=bend,
// shoulder −=raise forward, elbow −=bend, spine +=lean forward.
// ---------------------------------------------------------------------------

export const PLAYER_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.0,
});

/** Default leg geometry (used only if a rig doesn't provide its own). */
export const LEG = { HIP_Y: -0.04, THIGH: 0.5, SHIN: 0.4, FOOT_H: 0.17 };

const HREF = REF.heightIn / 36; // reference height in yards
const SKIN_SHADOW = 0.86;
const DARK = '#1a1f2b';

const _c = new THREE.Color();

/** Non-indexed, flat-normal, vertex-coloured copy of a geometry. */
export function prep(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.computeVertexNormals();
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * Tapered box spanning yBot..yTop. Top / bottom cross-sections can differ
 * (w = X size, d = Z size); z0 shifts it forward.
 */
function tbox(wTop, dTop, wBot, dBot, yBot, yTop, x0 = 0, z0 = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i,
      x0 + p.getX(i) * (top ? wTop : wBot),
      top ? yTop : yBot,
      z0 + p.getZ(i) * (top ? dTop : dBot));
  }
  return g;
}
const box = (w, d, yBot, yTop, x0 = 0, z0 = 0) => tbox(w, d, w, d, yBot, yTop, x0, z0);

function joint(parent, name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Collects coloured parts per joint, then merges each joint into one mesh. */
class PartList {
  constructor() { this.parts = new Map(); }
  add(jointObj, geo, color, xform) {
    if (xform) geo.applyMatrix4(xform);
    if (!this.parts.has(jointObj)) this.parts.set(jointObj, []);
    this.parts.get(jointObj).push(prep(geo, color));
    geo.dispose();
  }
  build() {
    const meshes = [];
    for (const [j, geos] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(geos, false), PLAYER_MATERIAL);
      geos.forEach(g => g.dispose());
      m.castShadow = true;
      j.add(m);
      meshes.push(m);
    }
    return meshes;
  }
}

const rotZ = (a, x = 0, y = 0, z = 0) => new THREE.Matrix4().makeRotationZ(a).setPosition(x, y, z);
const rotX = (a, x = 0, y = 0, z = 0) => new THREE.Matrix4().makeRotationX(a).setPosition(x, y, z);

/** Body dimensions (yards) from a resolved body. Exposed for tests/tools. */
export function bodyDims(body) {
  const P = body.p;
  const Hy = body.heightIn / 36;
  const f = Hy / HREF;              // height ratio
  const fw = Math.sqrt(f);          // widths follow height only mildly
  const hs = Math.pow(f, 0.2);      // helmet barely changes with height
  const hands = Math.pow(f, 0.4);   // hands/feet: modest

  const helmet = { w: 0.33 * hs, h: 0.36 * hs, d: 0.37 * hs, below: 0.07 * hs };
  const helmetAbove = helmet.h - helmet.below;

  // vertical chain (fractions of reference height), legs take more of extra height
  const legK = P.leg_length * (1 + 0.5 * (f - 1));
  const seg = {
    foot: 0.085, shin: 0.195 * legK, thigh: 0.245 * legK, hipDrop: 0.02,
    pelvisToSpine: 0.05 * P.torso_length, spineToChest: 0.13 * P.torso_length,
    chestToNeck: 0.095 * P.torso_length, neckToHead: 0.035,
  };
  const sum = Object.values(seg).reduce((a, b) => a + b, 0) * HREF;
  const k = (Hy - helmetAbove) / sum;
  for (const key in seg) seg[key] *= HREF * k;
  const armK = HREF * k * P.arm_length * (1 + 0.3 * (f - 1));

  return {
    Hy, f, helmet, ...seg,
    upperArm: 0.145 * armK, forearm: 0.13 * armK,
    padHalf: 0.44 * P.shoulder_width * fw,
    chestW: 0.66 * P.chest_width * fw, chestD: 0.36 * P.chest_depth * fw,
    waistW: 0.47 * P.waist_width * fw, waistD: 0.31 * P.waist_depth * Math.sqrt(P.abdomen_size) * fw,
    belly: 0.05 * Math.max(0, P.abdomen_size - 1) * fw,
    hipW: 0.53 * P.hip_width * fw, hipD: 0.31 * P.glute_size * fw,
    thighW: 0.24 * P.thigh_thickness * fw, thighD: 0.23 * P.thigh_thickness * fw,
    calfW: 0.19 * P.calf_thickness * fw, calfD: 0.19 * P.calf_thickness * fw,
    neckW: 0.17 * P.neck_thickness,
    upperArmW: 0.185 * P.upper_arm_thickness * fw, forearmW: 0.165 * P.forearm_thickness * fw,
    glove: { t: 0.125 * hands, l: 0.17 * hands, w: 0.15 * hands },
    cleat: { w: 0.19 * hands * (0.9 + 0.1 * P.calf_thickness), l: 0.36 * hands },
  };
}

/**
 * @param {object} o
 *  body    resolved body (Body.resolveBody)
 *  kit     region colours (Uniforms.resolveKit)
 *  skin    css colour
 *  number  jersey number (omit for no decals)
 *  name    name on the back
 */
export function createPlayerRig(o) {
  const D = bodyDims(o.body);
  const K = o.kit, skin = o.skin;
  const skinShade = new THREE.Color(skin).multiplyScalar(SKIN_SHADOW).getStyle();
  const parts = new PartList();

  const root = new THREE.Group();
  const tilt = joint(root, 'tilt');
  const yaw = joint(tilt, 'yaw');
  const standPelvis = D.foot + D.shin + D.thigh + D.hipDrop;
  const pelvis = joint(yaw, 'pelvis', 0, standPelvis, 0);

  // --- pelvis / pants ---------------------------------------------------------
  const pantsTop = D.pelvisToSpine + 0.03, pantsBot = -(D.hipDrop + 0.03);
  parts.add(pelvis, box(D.hipW, D.hipD, pantsBot, pantsTop, 0, -0.01), K.pants);
  for (const s of [1, -1]) parts.add(pelvis, box(0.026, 0.07, pantsBot + 0.02, pantsTop - 0.01, s * (D.hipW / 2 + 0.004)), K.pantStripe);

  // --- legs ---------------------------------------------------------------------
  const bones = { pelvis };
  const hipX = D.hipW / 4 + 0.005;
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    const hip = joint(pelvis, 'hip' + k, s * hipX, -D.hipDrop, 0);
    const twT = D.hipW / 2 - 0.01, tdT = D.hipD * 0.92, twB = D.thighW * 0.9, tdB = D.thighD * 0.95;
    parts.add(hip, tbox(twT, tdT, twB, tdB, -D.thigh + 0.1, 0.04), K.pants);
    parts.add(hip, box(twB * 1.06, tdB * 1.08, -D.thigh + 0.01, -D.thigh + 0.12, 0, 0.008), K.pants);  // knee pad
    // outside stripe follows the taper (offset so it sits on the outer face)
    const tilt = Math.atan2((twT - twB) / 2, D.thigh - 0.06);
    const sx = (twT + twB) / 4 + 0.006;
    parts.add(hip, box(0.026, 0.065, -D.thigh + 0.03, 0.035), K.pantStripe, rotZ(s * tilt, s * sx, 0, 0));
    const kn = joint(hip, 'kn' + k, 0, -D.thigh, 0);
    const cw = D.calfW, cd = D.calfD;
    parts.add(kn, box(cw * 0.94, cd * 0.94, -0.06, 0.035), skin);
    parts.add(kn, tbox(cw, cd, cw * 0.86, cd * 0.86, -(D.shin - 0.065), -0.06), K.socks);
    parts.add(kn, box(cw * 0.88, cd * 0.88, -D.shin + 0.01, -(D.shin - 0.07)), K.sockBand);
    const ank = joint(kn, 'ank' + k, 0, -D.shin, 0);
    const C = D.cleat, fz = C.l * 0.17;
    const cleat = box(C.w, C.l, -D.foot + 0.045, 0.02, 0, fz);
    const cp = cleat.attributes.position;               // slope the toe
    for (let i = 0; i < cp.count; i++) if (cp.getZ(i) > fz + C.l * 0.49 && cp.getY(i) > 0) cp.setY(i, -D.foot * 0.35);
    parts.add(ank, cleat, K.cleats);
    parts.add(ank, box(C.w * 0.55, C.l * 0.22, -D.foot * 0.36, -D.foot * 0.33, 0, fz + C.l * 0.3), K.cleatTrim, rotX(0.25));
    parts.add(ank, box(C.w * 1.01, C.l * 1.01, -D.foot + 0.02, -D.foot + 0.045, 0, fz), K.cleatTrim);
    for (const [sx, sz] of [[-1, 0.3], [1, 0.3], [-1, -0.05], [1, -0.05], [0, -0.38]]) {
      parts.add(ank, box(0.035, 0.035, -D.foot, -D.foot + 0.02, sx * C.w * 0.3, fz + sz * C.l), K.cleatTrim);
    }
    Object.assign(bones, { ['hip' + k]: hip, ['kn' + k]: kn, ['ank' + k]: ank });
  }

  // --- torso ----------------------------------------------------------------------
  const spine = joint(pelvis, 'spine', 0, D.pelvisToSpine, 0);
  parts.add(spine, box(D.waistW, D.waistD, -D.pelvisToSpine, D.spineToChest * 0.4, 0, D.belly * 0.5), K.jersey);
  const chest = joint(spine, 'chest', 0, D.spineToChest, 0);
  const chestTop = D.chestToNeck - 0.02, chestBot = -D.spineToChest * 0.75;
  parts.add(chest, tbox(D.chestW, D.chestD, D.waistW * 1.02, D.waistD, chestBot, chestTop, 0, D.belly * 0.25), K.jersey);
  // shoulder pads: chunky blocks with a trim band, top flush with the shoulder line
  const padH = 0.14, padTop = D.chestToNeck + 0.02;
  const padW = D.padHalf - D.chestW / 2 + 0.14;
  for (const s of [1, -1]) {
    const cx = s * (D.padHalf - padW / 2);
    parts.add(chest, box(padW, D.chestD * 1.06, padTop - padH, padTop, cx), K.jersey);
    parts.add(chest, box(0.05, D.chestD * 1.08, padTop - padH - 0.005, padTop + 0.005, s * (D.padHalf - 0.09)), K.trim);
  }
  // V-neck
  parts.add(chest, new THREE.CylinderGeometry(0.08, 0.0, 0.12, 3), skinShade,
    new THREE.Matrix4().compose(new THREE.Vector3(0, chestTop - 0.05, D.chestD / 2 + 0.002),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)), new THREE.Vector3(1, 1, 0.08)));

  // --- neck + helmet -----------------------------------------------------------------
  const neck = joint(chest, 'neck', 0, D.chestToNeck, 0);
  parts.add(neck, box(D.neckW, D.neckW * 0.95, -0.06, D.neckToHead + 0.02), skin);
  const head = joint(neck, 'head', 0, D.neckToHead, 0.01);
  const Hm = D.helmet, hb = -Hm.below, split = hb + Hm.h * 0.62, top = hb + Hm.h;
  parts.add(head, box(0.13, 0.12, hb - 0.03, hb + 0.06, 0, 0.06), skin);                              // chin / face
  parts.add(head, box(Hm.w, Hm.d, hb, split, 0, -0.01), K.helmet);
  parts.add(head, tbox(Hm.w * 0.8, Hm.d * 0.8, Hm.w, Hm.d, split, top, 0, -0.02), K.helmet);
  parts.add(head, box(0.065, Hm.d * 0.8 + 0.004, top - 0.002, top + 0.012, 0, -0.02), K.helmetStripe);  // top stripe
  parts.add(head, box(0.065, 0.012, hb + 0.05, split, 0, -0.01 - Hm.d / 2 - 0.004), K.helmetStripe);    // back stripe
  for (const s of [1, -1]) parts.add(head, box(0.03, 0.09, hb + 0.08, hb + 0.17, s * (Hm.w / 2 + 0.012), 0.02), K.helmetStripe);
  const fz = Hm.d / 2 - 0.01;
  parts.add(head, box(Hm.w * 0.72, 0.014, hb + 0.06, split + 0.02, 0, fz + 0.004), DARK);              // face opening
  // facemask: frame + one cross bar + two verticals
  const mz = fz + 0.03, mw = Hm.w * 0.8;
  parts.add(head, box(mw, 0.03, split - 0.005, split + 0.025, 0, mz), K.mask);
  parts.add(head, box(mw, 0.03, hb + 0.1, hb + 0.13, 0, mz), K.mask);
  parts.add(head, box(mw * 0.62, 0.03, hb - 0.01, hb + 0.02, 0, mz - 0.01), K.mask);
  for (const s of [1, -1]) {
    parts.add(head, box(0.03, 0.03, hb, hb + 0.12, s * 0.05, mz - 0.005), K.mask);
    parts.add(head, box(0.03, 0.06, hb + 0.02, split + 0.02, s * (mw / 2 - 0.015), mz - 0.02), K.mask);
  }

  // --- arms -----------------------------------------------------------------------
  const shX = D.padHalf - 0.12, shY = D.chestToNeck - 0.07;
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    const sh = joint(chest, 'sh' + k, s * shX, shY, 0);
    const uw = D.upperArmW;
    parts.add(sh, box(uw * 1.12, uw * 1.08, -0.13, 0.06), K.jersey);                    // sleeve
    parts.add(sh, box(uw, uw * 0.95, -D.upperArm - 0.01, -0.12), skin);
    const el = joint(sh, 'el' + k, 0, -D.upperArm, 0);
    const fw = D.forearmW;
    parts.add(el, tbox(fw, fw * 0.95, fw * 0.9, fw * 0.86, -(D.forearm - 0.06), 0.03), skin);
    parts.add(el, box(fw * 0.97, fw * 0.92, -D.forearm + 0.005, -(D.forearm - 0.065)), K.trim);  // wristband
    const hand = joint(el, 'hand' + k, 0, -D.forearm, 0);
    const G = D.glove;
    parts.add(hand, box(G.t, G.w, -G.l, 0.01, 0, 0.005), K.gloves);
    parts.add(hand, box(G.t * 0.5, G.w * 0.35, -G.l * 0.6, -G.l * 0.1, -s * G.t * 0.15, G.w * 0.55), K.gloves); // thumb
    parts.add(hand, box(0.008, G.w * 0.45, -G.l * 0.45, -G.l * 0.25, s * (G.t / 2 + 0.003)), K.trim);           // back patch
    Object.assign(bones, { ['sh' + k]: sh, ['el' + k]: el, ['hand' + k]: hand });
  }
  Object.assign(bones, { spine, chest, neck, head });

  const meshes = parts.build();
  const decals = o.number != null ? addNumbers(chest, D, K, o.number, o.name, chestBot, chestTop) : [];
  return {
    root, tilt, yaw, bones, meshes, decals, body: o.body, dims: D,
    scale: D.Hy / HREF,
    leg: { HIP_Y: -D.hipDrop, THIGH: D.thigh, SHIN: D.shin, FOOT_H: D.foot },
  };
}

// --- numbers + name ----------------------------------------------------------------
/**
 * Number/name decal material (shared with the character system). Texture: left half = front number,
 * right half = back (name above number). Planes use u 0..0.5 for the front, 0.5..1 for the back.
 */
export function numberDecalMaterial(K, number, name) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  const num = String(number);
  const font = (px) => `900 ${px}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const draw = (txt, x, y, px, stroke) => {
    ctx.font = font(px);
    if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = K.numberOutline; ctx.strokeText(txt, x, y); }
    ctx.fillStyle = K.number; ctx.fillText(txt, x, y);
  };
  draw(num, 128, 132, num.length > 1 ? 150 : 170, 14);                        // front
  if (name) draw(String(name).toUpperCase(), 384, 34, 40, 6);                 // back: name
  draw(num, 384, 156, num.length > 1 ? 150 : 170, 14);                        // back: number
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.78, depthWrite: false });
}

function addNumbers(chest, D, K, number, name, y0, y1) {
  const mat = numberDecalMaterial(K, number, name);

  // chest is a tapered box: decals lie on its sloped front/back faces
  const h = y1 - y0;
  const slope = Math.atan2((D.chestD - D.waistD) / 2, h);
  const yMid = y0 + h * 0.55, zMid = (D.chestD + D.waistD) / 4 + 0.004;
  const size = Math.min(D.chestW * 0.62, h * 0.85);
  const out = [];
  for (const back of [false, true]) {
    const g = new THREE.PlaneGeometry(size * 2, size);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (back ? 0.5 : 0));
    g.scale(0.5, 1, 1);
    const m = new THREE.Mesh(g, mat);
    const zb = D.belly * 0.25;
    if (back) { m.position.set(0, yMid, -zMid + zb); m.rotation.set(-slope, Math.PI, 0); }
    else { m.position.set(0, yMid - 0.02, zMid + zb); m.rotation.set(slope, 0, 0); }
    chest.add(m);
    out.push(m);
  }
  return out;
}

/** Bake a posed rig into one static, vertex-coloured geometry (root-local). */
export function bakeRig(rig) {
  rig.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  const geos = [];
  const m = new THREE.Matrix4();
  for (const mesh of rig.meshes) {
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const g = mesh.geometry.clone();
    g.applyMatrix4(m);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return merged;
}

export function disposeRig(rig) {
  for (const m of rig.meshes) m.geometry.dispose();
  for (const d of rig.decals || []) { d.geometry.dispose(); d.material.map?.dispose(); d.material.dispose(); }
}
