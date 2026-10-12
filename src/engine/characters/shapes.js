import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Flat-faced shape builders for the procedural characters.
//
// Everything is a LOFT: a list of cross-sections along one axis, joined by flat
// quads and capped at both ends. A section is a rectangle (optionally with
// chamfered corners → octagon), so one primitive covers tapered boxes, wedges,
// offset/leaning prisms and faceted heads. Faces are planar quads/triangles;
// the shared player material uses flatShading, so edges stay hard.
//
//   loft('y', [ { t: 0.5, a: [x0, x1], b: [z0, z1], c: 0.15 }, ... ])
//
// axis 'y': a = X range, b = Z range.   axis 'x': a = Y range, b = Z range.
// axis 'z': a = X range, b = Y range.   c = chamfer as a fraction of the
// smaller side (0 = sharp box corners, 0.5 = diamond).
// ---------------------------------------------------------------------------

function ring(s) {
  if (s.pts) return s.pts;                       // measured outline: [[a, b], ...], same count on every ring
  const [a0, a1] = s.a, [b0, b1] = s.b;
  const c = (s.c ?? 0) * Math.min(a1 - a0, b1 - b0);
  if (c <= 1e-6) return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  return [[a0 + c, b0], [a1 - c, b0], [a1, b0 + c], [a1, b1 - c], [a1 - c, b1], [a0 + c, b1], [a0, b1 - c], [a0, b0 + c]];
}

function toXYZ(axis, t, a, b) {
  if (axis === 'y') return [a, t, b];
  if (axis === 'x') return [t, a, b];
  return [a, b, t]; // 'z'
}

/** Lofted flat-faced solid through the given sections (sorted along the axis). */
export function loft(axis, sections) {
  const rings = sections.map(s => {
    // all rings need the same vertex count: give sharp rings 8 points too if any ring is chamfered
    const r = ring(s);
    return { s, r };
  });
  const n8 = rings.some(r => r.r.length === 8);
  if (n8) for (const r of rings) if (r.r.length === 4) {
    const [p0, p1, p2, p3] = r.r;
    r.r = [p0, p1, p1, p2, p2, p3, p3, p0];
  }
  const pts = rings.map(({ s, r }) => r.map(([a, b]) => toXYZ(axis, s.t, a, b)));
  const centre = (r) => r.reduce((m, p) => [m[0] + p[0] / r.length, m[1] + p[1] / r.length, m[2] + p[2] / r.length], [0, 0, 0]);

  const pos = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3();
  // push a triangle, flipping it so the normal points away from `inside`
  const tri = (p, q, r, inside) => {
    _a.fromArray(p); _b.fromArray(q); _c.fromArray(r);
    _n.subVectors(_b, _a).cross(_m.subVectors(_c, _a));
    if (_n.lengthSq() < 1e-14) return; // degenerate (collapsed chamfer corner)
    _m.set((p[0] + q[0] + r[0]) / 3 - inside[0], (p[1] + q[1] + r[1]) / 3 - inside[1], (p[2] + q[2] + r[2]) / 3 - inside[2]);
    if (_n.dot(_m) < 0) pos.push(...p, ...r, ...q); else pos.push(...p, ...q, ...r);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1], n = A.length;
    const ca = centre(A), cb = centre(B), mid = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      tri(A[k], A[k1], B[k1], mid);
      tri(A[k], B[k1], B[k], mid);
    }
  }
  // caps (fan from the ring centre; inside point nudged into the solid)
  const cap = (R, other) => {
    const c = centre(R), o = centre(other);
    for (let k = 0; k < R.length; k++) tri(c, R[k], R[(k + 1) % R.length], o);
  };
  cap(pts[0], pts[1]);
  cap(pts[pts.length - 1], pts[pts.length - 2]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Axis-aligned box from ranges: x [x0,x1], y [y0,y1], z [z0,z1]. */
export function boxR(x, y, z, c = 0) {
  return loft('y', [{ t: y[0], a: x, b: z, c }, { t: y[1], a: x, b: z, c }]);
}

/** Mirror ranges / sections to the other side of the body (x → −x). */
export const mx = ([a, b]) => [-b, -a];
export function mirrorSections(axis, sections) {
  if (axis === 'y' || axis === 'z') {
    return sections.map(s => ({ ...s, a: s.a && mx(s.a), pts: s.pts && s.pts.map(([a, b]) => [-a, b]) }));
  }
  return sections.map(s => ({ ...s, t: -s.t })).reverse(); // axis 'x': position along the axis is x
}
