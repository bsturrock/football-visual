#!/usr/bin/env python3
"""Probe a closed mesh for an interior cavity by ray casting (read-only).

    python3 tools/inspect/cavity_probe.py <file.glb>

Casts rays along the main axes through a grid and lists, for each ray, the
distances where it crosses the surface. A solid lump gives 2 crossings
(enter, exit); a hollow shell gives 4+ (outer, inner, inner, outer). Also
reports whether the bounding-box centre is inside material or inside air.
"""
import sys
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from inspect_glb import read_glb, accessor, node_matrix


def load(path):
    _, g, b = read_glb(path)
    nd = g['nodes'][g['scenes'][0]['nodes'][0]]
    M = node_matrix(nd)
    prim = g['meshes'][nd['mesh']]['primitives'][0]
    P = accessor(g, b, prim['attributes']['POSITION'])
    P = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]
    T = accessor(g, b, prim['indices']).reshape(-1, 3)
    return P[T]


def hits(tri, o, d):
    """Möller–Trumbore for one ray against all triangles → sorted hit distances."""
    v0, e1, e2 = tri[:, 0], tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    p = np.cross(d, e2); det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - v0; u = (s * p).sum(1) * inv
    q = np.cross(s, e1); v = (q * d).sum(1) * inv
    t = (q * e2).sum(1) * inv
    m = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    t = np.sort(t[m])
    return t[np.r_[True, np.diff(t) > 1e-6]] if len(t) else t   # drop duplicate hits on shared edges


def main():
    tri = load(sys.argv[1])
    lo, hi = tri.reshape(-1, 3).min(0), tri.reshape(-1, 3).max(0)
    c = (lo + hi) / 2
    print('bounds', lo.round(3), hi.round(3))
    for axis, name in ((2, 'front→back (−Z)'), (1, 'top→down (−Y)'), (0, 'side (−X)')):
        d = np.zeros(3); d[axis] = -1
        a, b = [i for i in range(3) if i != axis]
        print(f'\nRays {name}: crossings (distance from entry plane, m)')
        for fa in (0.3, 0.5, 0.7):
            row = []
            for fb in (0.3, 0.5, 0.7):
                o = np.zeros(3); o[axis] = hi[axis] + 0.01
                o[a] = lo[a] + fa * (hi[a] - lo[a]); o[b] = lo[b] + fb * (hi[b] - lo[b])
                h = hits(tri, o, d)
                row.append(f'{len(h)}x[' + ' '.join(f'{x:.2f}' for x in h[:6]) + ']')
            print('  ', '  '.join(row))
    # centre: count crossings of a ray from the centre; odd = inside material
    n = len(hits(tri, c, np.array([0.0, 1.0, 0.0001])))
    print('\ncentre', c.round(3), 'is inside', 'MATERIAL (solid)' if n % 2 else 'AIR (hollow or outside)', f'({n} crossings upward)')


if __name__ == '__main__':
    main()
