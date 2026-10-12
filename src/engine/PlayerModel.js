import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { BUILDS } from './constants.js';

// ---------------------------------------------------------------------------
// Low-poly player rig built entirely in code.
// Every part is a non-indexed, vertex-coloured geometry that shares ONE flat
// shaded material, so 22 players cost almost no material/state switches and
// any posed rig can be "baked" into a single static mesh (used for benches).
//
// The rig faces +Z. Hierarchy:
//   root (world position at feet)
//    └ tilt  (world-axis lean / fall rotation, pivot at the feet)
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

export const LEG = { HIP_Y: -0.04, THIGH: 0.47, SHIN: 0.45, FOOT_H: 0.075 };
export const STAND_PELVIS = -LEG.HIP_Y + LEG.THIGH + LEG.SHIN + LEG.FOOT_H;

const _c = new THREE.Color();

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

/** Lathe + vertex colours, with faces on one side (+X if side>0) recoloured as a stripe. */
export function stripedLathe(profile, segs, color, stripe, side, width = 0.97) {
  const g = prep(lathe(profile, segs, Math.PI / 2 - Math.PI / segs), color);
  const p = g.attributes.position, c = g.attributes.color;
  const sc = new THREE.Color(stripe);
  for (let i = 0; i < p.count; i += 3) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += p.getX(i + k); cz += p.getZ(i + k); }
    const l = Math.hypot(cx, cz) || 1;
    if ((cx / l) * side > width) for (let k = 0; k < 3; k++) c.setXYZ(i + k, sc.r, sc.g, sc.b);
  }
  return g;
}

/** Closed lathe from a [radius, y] profile (bottom → top). */
export function lathe(profile, segs = 7, phiStart = 0) {
  const pts = [new THREE.Vector2(0.0001, profile[0][1])];
  for (const [r, y] of profile) pts.push(new THREE.Vector2(Math.max(r, 0.0001), y));
  pts.push(new THREE.Vector2(0.0001, profile[profile.length - 1][1]));
  return new THREE.LatheGeometry(pts, segs, phiStart);
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

/** Cleat: a box with a sloped toe and heel. */
function cleatGeo(w, h, l) {
  const g = new THREE.BoxGeometry(w, h, l, 1, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    if (z > l * 0.49 && y > 0) p.setY(i, y - h * 0.65);       // toe slope
    if (z > l * 0.49) p.setX(i, p.getX(i) * 0.8);
    if (z < -l * 0.49 && y > 0) p.setZ(i, z + l * 0.08);       // heel
    if (Math.abs(z) < 0.01 && y > 0) p.setY(i, y - h * 0.15);  // instep
  }
  return g;
}

function addPart(parent, geo, color, pos, rot, scl, list) {
  const m = new THREE.Mesh(color === null ? geo : prep(geo, color), PLAYER_MATERIAL);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scl) m.scale.set(scl[0], scl[1], scl[2]);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  list.push(m);
  return m;
}

function joint(parent, name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/**
 * @param {object} o
 *  team: { primary, secondary, facemask, helmet, pants, stripe }
 *  build: 'line' | 'big' | 'skill' | 'qb'
 *  skin: css colour
 *  gloves / cleats: optional overrides
 */
export function createPlayerRig(o) {
  const B = BUILDS[o.build] || BUILDS.skill;
  const W = B.width * (o.widthMul || 1), belly = B.belly;
  const t = o.team;
  const isLine = o.build === 'line';
  const skin = o.skin;
  const skinDark = new THREE.Color(skin).multiplyScalar(0.86).getStyle();
  const primary = t.primary;
  const white = t.pants || '#f4f6f9';
  const gloves = o.gloves || (isLine ? '#2a2e38' : (o.build === 'qb' ? skin : primary));
  const cleats = o.cleats || (isLine ? '#262a35' : primary);
  const wrist = o.build === 'qb' ? '#f4f5f7' : (isLine ? '#f4f5f7' : primary);
  const meshes = [];

  const root = new THREE.Group();
  const tilt = joint(root, 'tilt');
  const yaw = joint(tilt, 'yaw');
  const scaleG = joint(yaw, 'scale');
  const H = B.height * (o.heightMul || 1);
  scaleG.scale.setScalar(H);
  const pelvis = joint(scaleG, 'pelvis', 0, STAND_PELVIS, 0);

  // --- pelvis / pants -------------------------------------------------------
  const stripeC = t.stripe || primary;
  addPart(pelvis, lathe([[0.16 * W, -0.16], [0.215 * W, -0.06], [0.2 * W * belly, 0.04], [0.17 * W * belly, 0.1]], 8),
    white, [0, 0, 0], null, [1, 1, 0.76], meshes);
  for (const side of [1, -1]) addPart(pelvis, box(0.035, 0.2, 0.07), stripeC, [0.222 * W * side, -0.02, 0], [0, 0, -side * 0.12], null, meshes);

  // --- legs -------------------------------------------------------------------
  const legs = {};
  const LW = Math.min(W, 1.3);
  for (const side of [1, -1]) {           // +1 = left (+X), −1 = right
    const k = side > 0 ? 'L' : 'R';
    const hip = joint(pelvis, 'hip' + k, 0.125 * W * side, LEG.HIP_Y, 0);
    addPart(hip, stripedLathe([[0.1 * LW, -0.47], [0.14 * LW, -0.37], [0.16 * LW, -0.22], [0.158 * LW, -0.06], [0.135 * LW, 0.06]], 10, white, stripeC, side),
      null, null, null, [1, 1, 0.95], meshes);
    const kn = joint(hip, 'kn' + k, 0, -LEG.THIGH, 0);
    // knee pad: chunky faceted block
    addPart(kn, new THREE.DodecahedronGeometry(0.1 * LW, 0), white, [0, 0.0, 0.04], null, [1.05, 1.0, 0.95], meshes);
    // shin: sock + white band (+ exposed skin for skill players)
    if (isLine || o.build === 'big') {
      addPart(kn, lathe([[0.066 * LW, -0.34], [0.088 * LW, -0.22], [0.095 * LW, -0.08], [0.085 * LW, 0]], 8), primary, null, null, null, meshes);
    } else {
      addPart(kn, lathe([[0.075, -0.1], [0.082, -0.04], [0.078, 0]]), skin, null, null, null, meshes);
      addPart(kn, lathe([[0.072, -0.135], [0.078, -0.1]]), '#f4f5f7', null, null, null, meshes);
      addPart(kn, lathe([[0.056, -0.34], [0.074, -0.24], [0.076, -0.135]]), primary, null, null, null, meshes);
    }
    addPart(kn, lathe([[0.062 * LW, -LEG.SHIN + 0.01], [0.066 * LW, -0.33]], 8), '#f4f5f7', null, null, null, meshes);
    const ank = joint(kn, 'ank' + k, 0, -LEG.SHIN, 0);
    addPart(ank, cleatGeo(0.15 * Math.min(W, 1.2), 0.12, 0.32), cleats, [0, -0.02, 0.065], null, null, meshes);
    if (!isLine) addPart(ank, box(0.135, 0.035, 0.1), '#f4f5f7', [0, -0.01, 0.02], null, null, meshes);
    addPart(ank, box(0.13, 0.025, 0.3), '#1d212b', [0, -0.072, 0.06], null, null, meshes); // sole/studs
    legs['hip' + k] = hip; legs['kn' + k] = kn; legs['ank' + k] = ank;
  }

  // --- torso ------------------------------------------------------------------
  const spine = joint(pelvis, 'spine', 0, 0.1, 0);
  addPart(spine, lathe([[0.222 * W * belly, -0.14], [0.215 * W * belly, 0.0], [0.235 * W * belly, 0.14], [0.255 * W, 0.28]], 8), primary, null, null, [1, 1, 0.74], meshes);
  const chest = joint(spine, 'chest', 0, 0.26, 0);
  addPart(chest, lathe([[0.255 * W, 0], [0.29 * W, 0.15], [0.29 * W, 0.29], [0.16 * W, 0.41]], 8), primary, null, null, [1, 1, 0.72], meshes);
  // shoulder pads — rounded blocks capping the shoulders and upper arms
  const padR = isLine ? 0.165 : 0.15;
  for (const side of [1, -1]) {
    addPart(chest, new THREE.IcosahedronGeometry(padR * W, 0), primary, [0.24 * W * side, 0.3, -0.005], [0.1, Math.PI / 2, side * 0.15], [1.2, 1.0, 1.2], meshes);
  }
  // V-neck collar
  addPart(chest, new THREE.CylinderGeometry(0.075, 0.0, 0.11, 3), isLine ? new THREE.Color(primary).multiplyScalar(0.7).getStyle() : '#f4f5f7',
    [0, 0.37, 0.155 * W * 0.72 + 0.035], [Math.PI * 0.1, Math.PI, 0], [1, 1, 0.2], meshes);
  addPart(chest, new THREE.CylinderGeometry(0.055, 0.0, 0.09, 3), skinDark, [0, 0.38, 0.155 * W * 0.72 + 0.04], [Math.PI * 0.1, Math.PI, 0], [1, 1, 0.2], meshes);

  // --- neck + head ------------------------------------------------------------
  const neck = joint(chest, 'neck', 0, 0.39, 0.03);
  addPart(neck, new THREE.CylinderGeometry(0.075 * Math.min(W, 1.15), 0.09 * Math.min(W, 1.15), 0.14, 6), skin, [0, 0.04, 0.0], null, null, meshes);
  const head = joint(neck, 'head', 0, 0.1, 0.02);
  addPart(head, new THREE.IcosahedronGeometry(0.115, 1), skin, [0, 0.06, 0.05], null, [0.9, 1, 1], meshes);
  // helmet shell
  addPart(head, new THREE.IcosahedronGeometry(0.215, 1), t.helmet || '#f2f3f6', [0, 0.12, -0.02], [0.15, 0, 0], [0.93, 0.93, 1.08], meshes);
  // dark face opening
  addPart(head, box(0.22, 0.16, 0.12), '#18213a', [0, 0.05, 0.175], null, null, meshes);
  // facemask cage (thin bars)
  const fm = t.facemask || '#f2f3f6';
  for (const [y, w] of [[0.11, 0.2], [0.05, 0.2], [-0.01, 0.16]]) addPart(head, box(w, 0.016, 0.018), fm, [0, y, 0.245], null, null, meshes);
  for (const x of [-0.045, 0.045]) addPart(head, box(0.015, 0.13, 0.016), fm, [x, 0.05, 0.247], null, null, meshes);
  for (const s of [-1, 1]) {
    addPart(head, box(0.016, 0.14, 0.08), fm, [0.1 * s, 0.05, 0.215], [0, s * 0.5, 0], null, meshes);
    addPart(head, new THREE.BoxGeometry(0.07, 0.19, 0.2), t.helmet || '#f2f3f6', [0.15 * s, 0.06, 0.1], [0, -s * 0.25, 0], null, meshes); // jaw flaps
    addPart(head, box(0.03, 0.05, 0.06), '#c9ced6', [0.19 * s, 0.03, 0.12], null, null, meshes); // jaw clip
  }

  // --- arms -------------------------------------------------------------------
  const arms = {};
  const aw = Math.min(W, 1.3) * (isLine ? 1.12 : 1);
  for (const side of [1, -1]) {
    const k = side > 0 ? 'L' : 'R';
    const sh = joint(chest, 'sh' + k, 0.29 * W * side, 0.29, 0);
    addPart(sh, lathe([[0.066 * aw, -0.31], [0.09 * aw, -0.24], [0.1 * aw, -0.13], [0.09 * aw, 0]]), skin, null, null, null, meshes);
    addPart(sh, lathe([[0.104 * aw, -0.11], [0.112 * aw, -0.02], [0.1 * aw, 0.06]]), primary, null, null, null, meshes);
    if (!isLine) addPart(sh, lathe([[0.105 * aw, -0.13], [0.105 * aw, -0.1]]), '#f4f5f7', null, null, null, meshes);
    const el = joint(sh, 'el' + k, 0, -0.3, 0);
    addPart(el, lathe([[0.052 * aw, -0.25], [0.074 * aw, -0.12], [0.07 * aw, -0.02], [0.06 * aw, 0.02]]), skin, null, null, null, meshes);
    if (isLine) {
      addPart(el, lathe([[0.062 * aw, -0.22], [0.066 * aw, -0.15]]), primary, null, null, null, meshes);
      addPart(el, lathe([[0.058 * aw, -0.28], [0.062 * aw, -0.22]]), '#f4f5f7', null, null, null, meshes);
    } else addPart(el, lathe([[0.056 * aw, -0.27], [0.06 * aw, -0.19]]), wrist, null, null, null, meshes);
    const hand = joint(el, 'hand' + k, 0, -0.27, 0);
    const gs = isLine ? 1.25 : 1;
    addPart(hand, box(0.085 * gs, 0.1 * gs, 0.06 * gs), gloves, [0, -0.05 * gs, 0.005], null, null, meshes);
    addPart(hand, box(0.085 * gs, 0.05 * gs, 0.055 * gs), gloves, [0, -0.105 * gs, 0.03 * gs], [0.5, 0, 0], null, meshes);
    addPart(hand, box(0.032 * gs, 0.06 * gs, 0.04 * gs), gloves, [-0.048 * side * gs, -0.05 * gs, 0.035 * gs], [0, 0, side * 0.3], null, meshes);
    arms['sh' + k] = sh; arms['el' + k] = el; arms['hand' + k] = hand;
  }

  const bones = { pelvis, spine, chest, neck, head, ...legs, ...arms };
  return { root, tilt, yaw, scale: H, bones, meshes };
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
}
