import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { PLAYER_MATERIAL, prep, numberDecalMaterial } from '../PlayerModel.js';
import { loft, boxR, mx, mirrorSections } from './shapes.js';
import { MEDIUM_BLUEPRINT as BP } from './mediumBlueprint.js';
import { bodyMapper, jointRegion } from './bodyMapper.js';
import { DEFAULT_FACE, faceLook } from './face.js';

// ---------------------------------------------------------------------------
// Milestone 2: the medium player rebuilt from flat-faced lofts.
//
// Body segments are lofted through the measured outlines in mediumBlueprint.js
// (generated from assets/meshy/source/new-base-player.glb by tools/blueprint/build_blueprint.py).
// Accent pieces (stripes, pads, collar, studs...) and the generic head use numbers from
// analysis/landmarks.json and tools/inspect/slice_glb.py.
// Coordinates: METRES, floor y = 0, +Z front, +X = player's left, T-pose —
// i.e. the same frame as the Meshy file, so parts can be compared 1:1.
//
// Parts are authored in that world frame, then moved into the local frame of
// the joint that carries them. Joints use the game's existing names and
// conventions (see PlayerModel.js), with the game's arms-DOWN rest pose:
// arm parts are rotated −90° (left) / +90° (right) about Z around the
// shoulder. Setting shL.rotation.z = +π/2 and shR.rotation.z = −π/2 shows
// the T-pose again.
// ---------------------------------------------------------------------------

/** Reference colours sampled from the Meshy texture. */
export const MEDIUM_KIT = {
  jersey: '#0255fd', trim: '#ffffff', pants: '#ffffff', pantStripe: '#0255fd',
  socks: '#0255fd', sockBand: '#ffffff', gloves: '#0255fd', gloveTrim: '#ffffff',
  cleats: '#0255fd', cleatTrim: '#ffffff', studs: '#d8dadf',
};

/** Joint centres in the T-pose world frame (metres). Inferred ones: see landmarks.json. */
export const JOINTS = {
  pelvis: [0, 0.93, -0.03],
  hipL: [0.105, 0.90, -0.02], knL: [0.14, 0.52, -0.045], ankL: [0.165, 0.11, -0.05],
  spine: [0, 1.0, -0.03], chest: [0, 1.22, -0.035], neck: [0, 1.49, -0.03], head: [0, 1.54, -0.01],
  shL: [0.30, 1.366, -0.03], elL: [0.465, 1.366, -0.03], handL: [0.665, 1.366, -0.03],
};
for (const k of ['hip', 'kn', 'ank', 'sh', 'el', 'hand']) {
  const [x, y, z] = JOINTS[k + 'L'];
  JOINTS[k + 'R'] = [-x, y, z];
}
/** Blueprint segment as loft sections for one side. */
/** Outline scaled about its centroid by `k` and pushed out by `grow` metres. */
function scaleRing(pts, k = 1, grow = 0) {
  const c = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
  return pts.map(([a, b]) => {
    const da = (a - c[0]) * k, db = (b - c[1]) * k, l = Math.hypot(da, db) || 1;
    return [c[0] + da + da / l * grow, c[1] + db + db / l * grow];
  });
}
/**
 * Blueprint segment as loft sections for one side.
 *  grow   push every ring out (bands that wrap another segment: never coplanar with it)
 *  inset  shrink the FIRST ring slightly (segment that starts inside its neighbour: no coincident faces)
 */
function seg(name, side, { grow = 0, inset = 0 } = {}) {
  const b = BP[name];
  const secs = b.rings.map((r, i) => ({ t: r.t, pts: scaleRing(r.pts, i === 0 ? 1 - inset : 1, grow) }));
  return side === 'L' ? secs : mirrorSections(b.axis, secs);
}
const segGeo = (name, side, opts) => loft(BP[name].axis, seg(name, side, opts));
/** Give every ring the same corner count by inserting points on the longest edges (shape unchanged). */
function matchCounts(rings) {
  const n = Math.max(...rings.map(r => r.pts.length));
  for (const r of rings) {
    const P = r.pts.slice();
    while (P.length < n) {
      let best = 0, bl = -1;
      for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length], l = Math.hypot(q[0] - P[i][0], q[1] - P[i][1]); if (l > bl) { bl = l; best = i; } }
      const q = P[(best + 1) % P.length];
      P.splice(best + 1, 0, [(P[best][0] + q[0]) / 2, (P[best][1] + q[1]) / 2]);
    }
    r.pts = P;
  }
  return rings;
}
/** Blueprint outline at any position along the segment (rings have matching corners: linear blend). */
function ringAt(name, t) {
  const R = BP[name].rings;
  let i = 1; while (i < R.length - 1 && R[i].t < t) i++;
  const a = R[i - 1], b = R[i], u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return a.pts.map((p, k) => [p[0] + (b.pts[k][0] - p[0]) * u, p[1] + (b.pts[k][1] - p[1]) * u]);
}
/**
 * Thin strip wrapping one corner of an outline (a, b plane): covers `w` along both
 * adjoining edges and sits `o` outside the surface. Used for stripes that follow facets.
 */
function cornerStrip(pts, i, w = 0.05, o = 0.004) {
  const n = pts.length, P = pts[i], A = pts[(i + n - 1) % n], B = pts[(i + 1) % n];
  const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const cx = pts.reduce((s, p) => s + p[0], 0) / n, cz = pts.reduce((s, p) => s + p[1], 0) / n;
  const outN = (u) => { const m = [u[1], -u[0]]; return (m[0] * (P[0] - cx) + m[1] * (P[1] - cz)) < 0 ? [-m[0], -m[1]] : m; };
  const ea = unit([A[0] - P[0], A[1] - P[1]]), eb = unit([B[0] - P[0], B[1] - P[1]]);
  const na = outN(ea), nb = outN(eb), nc = unit([na[0] + nb[0], na[1] + nb[1]]);
  const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
  const pa = add(P, ea, w), pb = add(P, eb, w);
  return [pa, add(pa, na, o), add(P, nc, o * 1.2), add(pb, nb, o), pb];
}
/** Part of a convex outline (a = height) at or above `y0`, closed along the cut. */
function clipAbove(pts, y0) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    if (p[0] >= y0) out.push(p);
    if ((p[0] >= y0) !== (q[0] >= y0)) { const t = (y0 - p[0]) / (q[0] - p[0]); out.push([y0, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
/**
 * Joint cap: 8-sided prism along `axis` spanning `span`, centred on `centre` (the two other coordinates,
 * in loft order), radius r. Symmetric about the hinge, so rotating the joint never exposes a corner.
 */
function hingeCap(axis, span, centre, r) {
  const k = r * Math.tan(Math.PI / 8);
  const [ca, cb] = centre;
  const pts = [[-k, -r], [k, -r], [r, -k], [r, k], [k, r], [-k, r], [-r, k], [-r, -k]].map(([a, b]) => [ca + a, cb + b]);
  return loft(axis, [{ t: span[0], pts }, { t: span[1], pts }]);
}
const S1 = (side, [a, b]) => (side === 'L' ? [a, b] : [-b, -a]);
const S1x = (side, x) => (side === 'L' ? x : -x);
const lerp = (a, b, t) => a + (b - a) * t;
const range = (pts, i) => [Math.min(...pts.map(p => p[i])), Math.max(...pts.map(p => p[i]))];

const PARENT = {
  pelvis: 'yaw', hipL: 'pelvis', knL: 'hipL', ankL: 'knL', hipR: 'pelvis', knR: 'hipR', ankR: 'knR',
  spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shL: 'chest', elL: 'shL', handL: 'elL', shR: 'chest', elR: 'shR', handR: 'elR',
};
const ARM = /^(sh|el|hand)([LR])$/;

/**
 * @param {object} [o]
 *  body  resolved body (Body.resolveBody); omitted = the measured medium player, unchanged
 *  kit   region colours; look: skin / hair / brows / eyes / mouth
 */
export function createMediumPlayer({ body = null, face = DEFAULT_FACE, kit = MEDIUM_KIT, look = null, number = null, name = null } = {}) {
  look = { ...faceLook(face), ...(look || {}) };
  const M = bodyMapper(body);
  const J = {};
  for (const [name, [x, y, z]] of Object.entries(JOINTS)) J[name] = M.point(x, y, z, jointRegion(name));
  const root = new THREE.Group();
  root.name = 'medium-player';
  const tilt = new THREE.Group(); tilt.name = 'tilt'; root.add(tilt);
  const yaw = new THREE.Group(); yaw.name = 'yaw'; tilt.add(yaw);
  const groups = { yaw };
  const world = { yaw: [0, 0, 0] };
  const bones = {};
  for (const name of Object.keys(PARENT)) {
    const g = new THREE.Group();
    g.name = name;
    const p = J[name], pp = world[PARENT[name]];
    const d = new THREE.Vector3(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    const m = ARM.exec(PARENT[name]);           // child of an arm joint: offset is in the hanging frame
    if (m) d.applyAxisAngle(new THREE.Vector3(0, 0, 1), m[2] === 'L' ? -Math.PI / 2 : Math.PI / 2);
    g.position.copy(d);
    groups[PARENT[name]].add(g);
    groups[name] = g; world[name] = p; bones[name] = g;
  }
  // hair is its own mesh so it can be hidden under a helmet
  const hair = new THREE.Group(); hair.name = 'hair'; bones.head.add(hair);

  const parts = new Map();
  const toLocal = (jointName) => {
    const p = J[jointName];
    const m = new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]);
    const a = ARM.exec(jointName);
    if (a) m.premultiply(new THREE.Matrix4().makeRotationZ(a[2] === 'L' ? -Math.PI / 2 : Math.PI / 2));
    return m;
  };
  const add = (target, jointName, geo, colour) => {
    if (!M.identity) {                       // reshape in the T-pose frame, before attaching to the joint
      const pos = geo.attributes.position, region = jointRegion(jointName);
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, ...M.point(pos.getX(i), pos.getY(i), pos.getZ(i), region));
    }
    geo.applyMatrix4(toLocal(jointName));
    if (!parts.has(target)) parts.set(target, []);
    parts.get(target).push(prep(geo, colour));
    geo.dispose();
  };
  const on = (jointName, geo, colour) => add(groups[jointName], jointName, geo, colour);

  buildLegsAndHips(on, kit, look);
  buildTorso(on, kit, look);
  buildHead(on, (geo, c) => add(hair, 'head', geo, c), look, face);
  buildArms(on, kit, look);

  const meshes = [];
  for (const [g, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), PLAYER_MATERIAL);
    geos.forEach(x => x.dispose());
    mesh.castShadow = true;
    g.add(mesh);
    meshes.push(mesh);
  }
  const decals = number != null ? addDecals(M, J, bones.chest, kit, number, name) : [];
  const L = J;
  return {
    root, tilt, yaw, bones, meshes, hair, decals, body, face,
    units: 'metres',
    heightM: M.heightM,
    headScale: M.headScale,             // head size factor (helmet fit follows it)
    helmet: null,
    leg: { HIP_Y: L.hipL[1] - L.pelvis[1], THIGH: L.hipL[1] - L.knL[1], SHIN: L.knL[1] - L.ankL[1], FOOT_H: L.ankL[1] },
    trianglesByJoint: Object.fromEntries(meshes.map(m => [m.parent.name, m.geometry.attributes.position.count / 3])),
    triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0),
  };
}

// chest front / back z at height y (blueprint 'chest' rings, measured): the decals lie on these slopes
const CHEST_FRONT = [[1.13, 0.1029], [1.25, 0.1075], [1.33, 0.1216]];
const CHEST_BACK = [[1.13, -0.1608], [1.25, -0.1816], [1.33, -0.1996]];
const zOn = (keys, y) => { for (let i = 1; i < keys.length; i++) if (y <= keys[i][0]) { const [y0, z0] = keys[i - 1], [y1, z1] = keys[i]; return z0 + (z1 - z0) * (y - y0) / (y1 - y0); } return keys.at(-1)[1]; };

/** Jersey number (front) and name + number (back) as decal planes lying on the reshaped chest. */
function addDecals(M, J, chest, K, number, name) {
  const mat = numberDecalMaterial(K, number, name);
  const halfW = Math.abs(M.point(0.16, 1.24, 0.1, 'torso')[0]);
  const size = Math.min(2 * halfW * 0.8, 0.28);     // the digits fill ~60% of the plane; corners are transparent
  const out = [];
  for (const back of [false, true]) {
    const keys = back ? CHEST_BACK : CHEST_FRONT;
    const A = M.point(0, 1.12, zOn(keys, 1.12), 'torso'), B = M.point(0, 1.28, zOn(keys, 1.28), 'torso');
    const dy = B[1] - A[1], dz = B[2] - A[2], l = Math.hypot(dy, dz);
    const n = back ? [0, dz / l, -dy / l] : [0, -dz / l, dy / l];          // outward normal in the y-z plane
    const g = new THREE.PlaneGeometry(size, size);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (back ? 0.5 : 0));
    const m = new THREE.Mesh(g, mat);
    m.position.set((A[0] + B[0]) / 2 - J.chest[0], (A[1] + B[1]) / 2 - J.chest[1] + (back ? 0.01 : 0), (A[2] + B[2]) / 2 - J.chest[2] + n[2] * 0.004);
    // front: tilt about X so the plane's +Z is the normal; back: turn around (π about Y) first
    if (back) m.quaternion.setFromEuler(new THREE.Euler(Math.atan2(-n[1], -n[2]), Math.PI, 0, 'YXZ'));
    else m.rotation.x = Math.atan2(-n[1], n[2]);
    chest.add(m);
    out.push(m);
  }
  return out;
}

/** Put a rig into the reference T-pose (arms out). */
export function tPose(rig) {
  for (const b of Object.values(rig.bones)) b.rotation.set(0, 0, 0);
  rig.bones.shL.rotation.z = Math.PI / 2;
  rig.bones.shR.rotation.z = -Math.PI / 2;
}

// --- legs + hips ----------------------------------------------------------------
function buildLegsAndHips(on, K, L) {
  // crotch filler (pelvis), kept inside the thigh outlines so it only shows when the legs spread
  on('pelvis', boxR([-0.14, 0.14], [0.84, 0.99], [-0.12, 0.07]), K.pants);

  for (const side of ['L', 'R']) {
    const S = side === 'L' ? (s) => s : (s) => mirrorSections('y', s);
    const X = side === 'L' ? (r) => r : mx;
    const colour = (n) => (BP[n].colour === 'skin' ? L.skin : K[BP[n].colour]);
    for (const n of ['thigh', 'sock', 'cleat', 'sole']) on(BP[n].joint + side, segGeo(n, side), colour(n));
    on('ank' + side, segGeo('sockBand', side, { grow: 0.002 }), K.sockBand);          // band: 2 mm proud of the sock
    // knee: one 8-sided prism along the hinge (X) axis, centred on the pivot. It IS the skin band between
    // pants (0.555) and sock (0.465) and fills the joint at any bend; its top and bottom hide inside them.
    on('kn' + side, hingeCap('x', S1(side, [0.074, 0.216]), [0.52, -0.045], 0.088), L.skin);
    // side stripes: wrap the front-outer and back-outer corners of the thigh (as on the Meshy pants)
    for (const sign of [1, -1]) {
      const strip = BP.thigh.rings.map(r => {
        let best = 0;
        r.pts.forEach((p, i) => { if (p[0] + sign * p[1] > r.pts[best][0] + sign * r.pts[best][1]) best = i; });
        return { t: r.t, pts: cornerStrip(r.pts, best, 0.032) };
      });
      on('hip' + side, loft('y', S(strip)), K.pantStripe);
    }
    // toe patch + studs
    on('ank' + side, loft('y', S([
      { t: 0.139, a: [0.15, 0.225], b: [0.12, 0.175] },
      { t: 0.152, a: [0.15, 0.225], b: [0.10, 0.155] },
    ])), K.cleatTrim);
    for (const z of [0.15, 0.04, -0.15]) {
      on('ank' + side, boxR(X([0.10, 0.28]), [0.0, 0.017], [z - 0.025, z + 0.025]), K.studs);
    }
  }
}

// --- torso -------------------------------------------------------------------
function buildTorso(on, K, L) {
  on('spine', segGeo('waist', 'L'), K.jersey);
  on('chest', segGeo('chest', 'L'), K.jersey);
  // shoulder pads: measured cross-sections across X (blueprint 'pad'), so the underside wraps
  // down to the chest at 1.25 and onto the arm at 1.28; an extra inner section reaches under the yoke
  const padRings = [{ t: 0.10, pts: scaleRing(BP.pad.rings[0].pts, 0.94) }, ...BP.pad.rings];   // inner section tucked inside chest / yoke
  // stripe: the upper part (y >= 1.40) of the pad outline between x 0.265 and 0.305, pushed 4 mm out
  const stripeRing = (pts) => {
    const top = clipAbove(pts, 1.40);
    const c = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
    return top.map(([y, z]) => { const dy = y - c[0], dz = z - c[1], l = Math.hypot(dy, dz) || 1; return [y + dy / l * 0.004, z + dz / l * 0.004]; });
  };
  const stripe = [0.265, 0.305].map(t => ({ t, pts: stripeRing(BP.pad.rings.find(r => r.t === t).pts) }));
  for (const side of ['L', 'R']) {
    const S = side === 'L' ? (x) => x : (x) => mirrorSections('x', x);
    on('chest', loft('x', S(padRings)), K.jersey);
    on('chest', loft('x', S(stripe)), K.trim);
  }
  // front yoke: jersey between the pads, sloping back toward the neck (measured from the jersey colour)
  // up to 1.428: 1.5 mm in front of the chest's measured front (blueprint 'chest'), so the two read as one surface
  const yokeZ = [[1.33, 0.1231], [1.405, 0.1217], [1.428, 0.1109], [1.445, 0.101], [1.475, 0.093], [1.505, 0.083], [1.534, 0.060]];
  on('chest', loft('y', yokeZ.map(([t, z]) => ({ t, a: [-0.105, 0.105], b: [-0.11, z] }))), K.jersey);
  // U neckline: skin plate on the yoke, a point at 1.445 widening to the jaw
  const zAt = (y) => { for (let i = 1; i < yokeZ.length; i++) if (y <= yokeZ[i][0]) { const [y0, z0] = yokeZ[i - 1], [y1, z1] = yokeZ[i]; return z0 + (z1 - z0) * (y - y0) / (y1 - y0); } return yokeZ.at(-1)[1]; };
  on('chest', loft('y', [[1.445, 0.012], [1.46, 0.057], [1.49, 0.068], [1.505, 0.084], [1.536, 0.086]]
    .map(([t, w]) => ({ t, a: [-w, w], b: [zAt(t) - 0.03, zAt(t) + 0.003] }))), L.skin);
  // back yoke: jersey across the back of the neck between the pads
  on('chest', loft('y', [
    { t: 1.39, a: [-0.105, 0.105], b: [-0.206, -0.105] },
    { t: 1.46, a: [-0.105, 0.105], b: [-0.172, -0.105] },
    { t: 1.534, a: [-0.105, 0.105], b: [-0.138, -0.105] },
  ]), K.jersey);
  // neck column (mostly hidden by the jaw and collar)
  on('neck', boxR([-0.088, 0.088], [1.46, 1.625], [-0.125, 0.06], 0.15), L.skin);   // up into the skull, visible under the jaw
}

// --- head ----------------------------------------------------------------------
// Procedural head (face.js) on the measured Meshy head: a tall rounded rectangle with a FLAT face plane
// at z 0.112, square jaw, light chamfers. The face's shape controls reshape it (all neutral = the
// measured head); hair is a separate mesh (hidden under a helmet), beards are on the head (visible
// through a facemask). Measured numbers: see M1_REPORT.md, revisions 5–7.
function buildHead(on, onHair, L, F) {
  const S = F.shape;
  const FACE = 0.112;                                   // z of the flat face plane
  // whole-head reshape: width (jaw width below the cheekbones), length above the eyes, chin up/down
  const jawW = S.jawWidth, headW = S.headWidth, headL = S.headLength;
  const reshape = (geo) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i);
      x *= lerp(jawW, headW, Math.min(1, Math.max(0, (y - 1.55) / 0.07)));
      if (y > 1.60) y = 1.60 + (y - 1.60) * headL;
      if (y < 1.585) y += S.chin * 0.006 * (1.585 - y) / 0.052;     // chin: ±6 mm at the bottom
      p.setXY(i, x, y);
    }
    return geo;
  };
  const head = (geo, c) => on('head', reshape(geo), c);
  const hairOn = (geo, c) => onHair(reshape(geo), c);

  // seen from above the Meshy head is a tapered octagon: face ±0.08 (z ≈ 0.1), widest ±0.11 at the
  // ears (z −0.06..0), back ±0.075 (z −0.15). `w` = half-width at the ears, front/back scale with it.
  const oct = (t, w, zb, zf, fw = w * 0.76, bw = w * 0.68) => ({ t, pts: [
    [-bw, zb], [bw, zb], [w, -0.065], [w, 0.03], [fw, zf], [-fw, zf], [-w, 0.03], [-w, -0.065],
  ] });
  // skull from the cheekbones up (front plane 3 mm back at the bottom ring so it never fights the jaw)
  head(loft('y', [
    oct(1.615, 0.110, -0.141, FACE - 0.003),
    oct(1.705, 0.112, -0.145, FACE),                                        // skull sits ~6 mm inside the hair
    oct(1.765, 0.106, -0.132, FACE - 0.004),
    oct(1.800, 0.086, -0.085, 0.085),
  ]), L.skin);
  // jaw: lofted front→back so its underside rises from the chin (1.533) toward the ear, as on Meshy.
  // From the front the cheeks drop straight to the jaw corner (1.572, just under the mouth), then one
  // plane each side turns in to a flat chin (±0.058): a U, not a V.
  const jaw = (z, chinW, chinY, sideW, sideY, top = 1.64, out = 0) => ({ t: z, pts: [
    [-chinW - out, chinY - out], [chinW + out, chinY - out], [sideW + out, sideY], [sideW + out, top], [-sideW - out, top], [-sideW - out, sideY],
  ] });
  const JAW = [
    [-0.085, 0.085, 1.602, 0.106, 1.612], [-0.050, 0.082, 1.580, 0.110, 1.598], [0.000, 0.074, 1.556, 0.110, 1.585],
    [0.060, 0.064, 1.540, 0.100, 1.578], [FACE, 0.058, 1.533, 0.084, 1.572],
  ];
  head(loft('z', JAW.map(r => jaw(...r))), L.skin);
  // ears: flat tabs (Meshy: out to x 0.127, y 1.62–1.69)
  const er = S.earSize, eh = 0.034 * er, ey = 1.656;
  for (const s of [1, -1]) head(boxR(s > 0 ? [0.110, 0.110 + 0.016 * er] : [-0.110 - 0.016 * er, -0.110], [ey - eh, ey + eh], [-0.032 * er, 0.008]), L.skin);
  // nose: wedge from 1.60 to 1.70, ±0.025 at the base, tip z 0.147 at 1.62
  const nw = S.noseWidth, nl = S.noseLength, ny = (y) => 1.70 - (1.70 - y) * nl;
  head(loft('y', [
    { t: ny(1.604), a: [-0.016 * nw, 0.016 * nw], b: [FACE - 0.01, FACE + 0.008] },
    { t: ny(1.622), a: [-0.024 * nw, 0.024 * nw], b: [FACE - 0.01, FACE + 0.033] },
    { t: ny(1.660), a: [-0.022 * nw, 0.022 * nw], b: [FACE - 0.01, FACE + 0.013] },
    { t: 1.700, a: [-0.010 * nw, 0.010 * nw], b: [FACE - 0.01, FACE + 0.002] },
  ]), L.skin);
  const plate = (x0, x1, y0, y1, colour, d = 0.002) => head(boxR([x0, x1], [y0, y1], [FACE - 0.004, FACE + d]), colour);
  const ex = 0.042 * S.eyeSpacing, ew = 0.014 * S.eyeSize, eh2 = 0.010 * S.eyeSize;
  const by = S.browHeight * 0.004, bt = S.browTilt * 0.005, bth = 0.024 * S.browThick;
  for (const s of [1, -1]) {
    plate(s * ex - ew, s * ex + ew, 1.660 - eh2, 1.660 + eh2, L.eyes);                       // eyes 0.028 × 0.020
    // brows: thick bars; tilt lowers the inner end (stern) or raises it (worried)
    const inner = { a: [1.676 + by - bt, 1.676 + by - bt + bth], b: [FACE - 0.004, FACE + 0.006] };
    const outer = { a: [1.682 + by + bt, 1.682 + by + bt + bth * 0.9], b: [FACE - 0.004, FACE + 0.006] };
    head(loft('x', s > 0 ? [{ t: 0.008, ...inner }, { t: 0.072, ...outer }] : [{ t: -0.072, ...outer }, { t: -0.008, ...inner }]), L.brows);
  }
  const mw = 0.029 * S.mouthWidth;
  plate(-mw, mw, 1.585, 1.589, L.mouth);                                                     // mouth line

  // beards (on the head mesh: visible through a facemask)
  const beardShell = (top, colour, out) => head(loft('z', JAW.map(([z, cw, cy, sw, sy]) => jaw(z, cw, cy, sw, sy, Math.min(top, sy + 0.035), out))), colour);
  if (F.beard === 'stubble') beardShell(1.60, L.stubble, 0.0025);
  if (F.beard === 'full') {
    beardShell(1.62, L.hair, 0.006);
    plate(-0.034, 0.034, 1.590, 1.598, L.hair, 0.006);                                         // moustache joins the beard
  }
  if (F.beard === 'goatee') {
    head(boxR([-0.030, 0.030], [1.528, 1.580], [FACE - 0.02, FACE + 0.006], 0.15), L.hair);    // chin tuft
    plate(-0.032, 0.032, 1.590, 1.598, L.hair, 0.006);
  }
  if (F.beard === 'moustache') plate(-0.034, 0.034, 1.590, 1.599, L.hair, 0.006);

  // hair styles (separate mesh)
  if (F.hairStyle === 'bald') return;
  const back = (bottom, zFront) => hairOn(loft('y', [               // back and sides, front edge sloping to the nape
    oct(bottom, 0.115, -0.143, -0.100, 0.115, 0.080),
    oct(1.680, 0.117, -0.150, -0.020, 0.117, 0.082),
    oct(1.745, 0.117, -0.152, zFront, 0.117, 0.082),
  ]), L.hair);
  if (F.hairStyle === 'short') {                       // the measured Meshy cut: cap + back/sides
    hairOn(loft('y', [
      oct(1.742, 0.117, -0.150, FACE + 0.006),
      oct(1.772, 0.112, -0.139, FACE + 0.010),
      oct(1.802, 0.092, -0.093, 0.105),
      oct(1.822, 0.060, -0.048, 0.062),
    ]), L.hair);
    back(1.620, 0.060);
  } else if (F.hairStyle === 'buzz') {                 // thin: hugs the skull, higher hairline
    hairOn(loft('y', [
      oct(1.752, 0.116, -0.147, FACE + 0.002),
      oct(1.780, 0.110, -0.136, FACE + 0.002),
      oct(1.806, 0.090, -0.089, 0.090),
      oct(1.814, 0.060, -0.050, 0.055),
    ]), L.hair);
    back(1.640, 0.050);
  } else if (F.hairStyle === 'flattop') {              // vertical sides, flat raised top
    hairOn(loft('y', [
      oct(1.742, 0.118, -0.150, FACE + 0.006),
      oct(1.800, 0.112, -0.140, FACE + 0.008),
      oct(1.865, 0.104, -0.128, FACE + 0.002),
    ]), L.hair);
    back(1.630, 0.060);
  } else if (F.hairStyle === 'curly') {                // fuller, rounded: ~2 cm all round
    hairOn(loft('y', [
      oct(1.730, 0.134, -0.168, FACE + 0.012),
      oct(1.790, 0.130, -0.160, FACE + 0.014),
      oct(1.835, 0.106, -0.115, 0.110),
      oct(1.852, 0.070, -0.060, 0.064),
    ]), L.hair);
    hairOn(loft('y', [
      oct(1.630, 0.128, -0.160, -0.090, 0.128, 0.090),
      oct(1.690, 0.134, -0.168, -0.010, 0.134, 0.095),
      oct(1.740, 0.134, -0.168, 0.060, 0.134, 0.095),
    ]), L.hair);
  }
}

// --- arms (authored in the T-pose along ±X, carried by sh/el/hand) --------------
function buildArms(on, K, L) {
  for (const side of ['L', 'R']) {
    const S = side === 'L' ? (s) => s : (s) => mirrorSections('x', s);
    const X = side === 'L' ? (r) => r : mx;
    // shoulder: a rounded jersey nub centred on the shoulder joint (looks the same however the arm turns,
    // so nothing pokes out from under the pad); shows only as the bit of sleeve under the pad, as on Meshy
    const [shx, shy, shz] = JOINTS['sh' + side];
    const nub = (z, r) => ({ t: z, pts: [[-0.38, -0.92], [0.38, -0.92], [0.92, -0.38], [0.92, 0.38], [0.38, 0.92], [-0.38, 0.92], [-0.92, 0.38], [-0.92, -0.38]].map(([a, b]) => [shx + a * r, shy + b * r]) });
    on('sh' + side, loft('z', [nub(shz - 0.10, 0.045), nub(shz - 0.06, 0.072), nub(shz + 0.04, 0.072), nub(shz + 0.075, 0.045)]), K.jersey);
    on('sh' + side, segGeo('upperArm', side), L.skin);
    on('el' + side, segGeo('forearm', side, { inset: 0.03 }), L.skin);               // starts inside the upper arm's end
    // elbow cap: the elbow hinge is vertical in the T-pose, so the prism runs along Y around the pivot
    // (kept inside the forearm's bevelled outline: span and radius smaller than the arm, so its corners never show)
    on('el' + side, hingeCap('y', [1.31, 1.425], [S1x(side, 0.465), -0.03], 0.07), L.skin);
    on('el' + side, segGeo('wristband', side, { grow: 0.002 }), K.trim);             // band: 2 mm proud of the forearm
    on('hand' + side, segGeo('palm', side), K.gloves);
    on('hand' + side, segGeo('fingers', side, { inset: 0.04 }), K.gloves);          // starts inside the palm's end
    on('hand' + side, segGeo('thumb', side), K.gloves);
    // white patch on the back of the glove: the palm's own top surface (top 7 mm of its outline) over
    // x 0.70–0.775, pushed 1.5 mm out, so it lies on the glove whatever the outline's bevels do
    const patch = [0.70, 0.775].map(t => {
      const pts = ringAt('palm', t), top = Math.max(...pts.map(p => p[0]));
      return { t, pts: scaleRing(clipAbove(pts, top - 0.007), 1, 0.0015) };
    });
    matchCounts(patch);
    on('hand' + side, loft('x', S(patch)), K.gloveTrim);
  }
}
