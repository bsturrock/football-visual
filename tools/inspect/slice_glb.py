#!/usr/bin/env python3
"""Exact plane sections of a GLB mesh (read-only).

    python3 tools/inspect/slice_glb.py <file.glb> <axis x|y|z> <from> <to> <step> [--where "expr"]

For each plane, intersects every triangle and prints the extents of the cut
on the other two axes. Coordinates are re-based so the floor is y = 0.
--where filters the cut points with a numpy expression over x, y, z
(e.g. "x > 0.02" to look at the left leg only).
"""
import sys
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from cavity_probe import load


def section(tri, axis, c):
    d = tri[:, :, axis] - c
    pts = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        a, b = d[:, i], d[:, j]
        m = (a * b) < 0
        t = a[m] / (a[m] - b[m])
        pts.append(tri[m, i] + (tri[m, j] - tri[m, i]) * t[:, None])
    return np.vstack(pts) if pts else np.zeros((0, 3))


def main():
    f, axis, a, b, st = sys.argv[1], 'xyz'.index(sys.argv[2]), *map(float, sys.argv[3:6])
    where = sys.argv[sys.argv.index('--where') + 1] if '--where' in sys.argv else None
    tri = load(f)
    tri[:, :, 1] -= tri[:, :, 1].min()
    others = [k for k in range(3) if k != axis]
    for c in np.arange(a, b + 1e-9, st):
        p = section(tri, axis, c)
        if where is not None and len(p):
            x, y, z = p[:, 0], p[:, 1], p[:, 2]
            p = p[eval(where)]
        if not len(p):
            print(f'{c:.3f}  -'); continue
        print(f'{c:.3f}  ' + '  '.join(f'{"xyz"[k]}[{p[:, k].min():+.3f},{p[:, k].max():+.3f}]' for k in others))


if __name__ == '__main__':
    main()
