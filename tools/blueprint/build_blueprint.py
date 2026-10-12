#!/usr/bin/env python3
"""Build the medium-player blueprint from the Meshy GLB (offline, read-only).

    python3 tools/blueprint/build_blueprint.py

Reads   assets/meshy/source/new-base-player.glb
Writes  src/engine/characters/mediumBlueprint.js   (generated: do not edit by hand)

For every body segment (left side; the right is mirrored at runtime) the mesh
is cut with planes at a few chosen levels. Each cut becomes a CONVEX outline,
simplified to its few dominant corners (low poly, big flat faces), and all
rings of one segment get the same corner count so they loft into clean quads.
Coordinates: metres, floor y = 0, +Z front, +X player's left (Meshy frame).
"""
import json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/inspect'))
from cavity_probe import load            # noqa: E402
from slice_glb import section            # noqa: E402

SRC = ROOT / 'assets/meshy/source/new-base-player.glb'
OUT = ROOT / 'src/engine/characters/mediumBlueprint.js'
VERSION = 1

# name: joint, colour region, slicing axis, levels, point filter, max corners
SEGMENTS = {
    'thigh':     ('hip',   'pants',  'y', [0.555, 0.64, 0.73, 0.86, 0.99],          'x > 0.004', 8),
    'sock':      ('kn',    'socks',  'y', [0.20, 0.33, 0.465],                      'x > 0.004', 8),
    'sockBand':  ('ank',   'sockBand', 'y', [0.17, 0.205],                         'x > 0.004', 8),
    'sole':      ('ank',   'cleatTrim', 'y', [0.017, 0.045],                        'x > 0.004', 8),
    'cleat':     ('ank',   'cleats', 'y', [0.045, 0.12, 0.155, 0.175],               'x > 0.004', 8),
    'waist':     ('spine', 'jersey', 'y', [0.985, 1.07, 1.15],                      'abs(x) < 0.195', 6),
    'chest':     ('chest', 'jersey', 'y', [1.13, 1.25, 1.33, 1.405, 1.428],                'abs(x) < 0.185', 6),
    'pad':       ('chest', 'jersey', 'x', [0.19, 0.265, 0.305, 0.335, 0.358],      '(y > 1.2) & (y < 1.54)', 10),
    'upperArm':  ('sh',    'skin',   'x', [0.376, 0.468],                            'y > 1.2', 8),
    'forearm':   ('el',    'skin',   'x', [0.466, 0.64],                            'y > 1.2', 8),
    'wristband': ('el',    'trim',   'x', [0.636, 0.676],                           'y > 1.2', 8),
    'palm':      ('hand',  'gloves', 'x', [0.674, 0.74, 0.80, 0.825],               '(y > 1.2) & (z < 0.058)', 8),
    'thumb':     ('hand',  'gloves', 'y', [1.292, 1.31, 1.335, 1.36, 1.40],         '(x > 0.68) & (x < 0.818) & (y > 1.2) & (z > 0.045)', 6),
    'fingers':   ('hand',  'gloves', 'x', [0.82, 0.935],                            '(y > 1.2) & (z < 0.06)', 6),
}
AXES = {'x': (0, (1, 2)), 'y': (1, (0, 2))}   # slice axis index, (a, b) plane axes
SIMPLIFY_TOL = 0.012                           # metres: corners closer than this to a straight edge are dropped


def hull(p):
    p = sorted(set(map(tuple, np.round(p, 5))))
    if len(p) < 3: return np.array(p)
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    return np.array(lo[:-1] + up[:-1])            # counter-clockwise


def simplify(poly, tol, max_n):
    """Visvalingam on a closed polygon: drop the least significant corner until all are significant."""
    P = list(map(np.array, poly))
    def sig(i):
        a, b, c = P[i - 1], P[i], P[(i + 1) % len(P)]
        ab = c - a
        L = np.linalg.norm(ab) + 1e-12
        return abs(ab[0] * (b[1] - a[1]) - ab[1] * (b[0] - a[0])) / L   # distance of b from chord a-c
    while len(P) > 4:
        s = [sig(i) for i in range(len(P))]
        i = int(np.argmin(s))
        if s[i] > tol and len(P) <= max_n: break
        P.pop(i)
    return np.array(P)


def resample(P, n):
    """Insert corners on the longest edges until the ring has n points (shape unchanged)."""
    P = [p for p in P]
    while len(P) < n:
        L = [np.linalg.norm(P[(i + 1) % len(P)] - P[i]) for i in range(len(P))]
        i = int(np.argmax(L))
        P.insert(i + 1, (P[i] + P[(i + 1) % len(P)]) / 2)
    return np.array(P)


def align(rings):
    """Rotate each ring so corner 0 sits in the same direction; avoids twisted lofts."""
    out = []
    for R in rings:
        c = R.mean(0)
        ang = np.arctan2(R[:, 1] - c[1], R[:, 0] - c[0])
        out.append(np.roll(R, -int(np.argmin(np.abs(ang - 0.3))), axis=0))   # start just past +a (avoids a tie at 0)
    # then minimise total corner travel between consecutive rings
    for k in range(1, len(out)):
        best = min(range(len(out[k])), key=lambda s: np.linalg.norm(np.roll(out[k], -s, 0) - out[k - 1], axis=1).sum())
        out[k] = np.roll(out[k], -best, 0)
    return out


def main():
    tri = load(str(SRC))
    tri[:, :, 1] -= tri[:, :, 1].min()
    blueprint = {}
    report = []
    for name, (joint, colour, axis, levels, where, max_n) in SEGMENTS.items():
        ax, (ia, ib) = AXES[axis]
        rings = []
        for t in levels:
            # nudge levels that land exactly on a vertex plane
            p = section(tri, ax, t + 1e-5)
            x, y, z = p[:, 0], p[:, 1], p[:, 2]
            p = p[eval(where)]
            assert len(p) >= 3, f'{name}: empty cut at {t}'
            rings.append(simplify(hull(p[:, [ia, ib]]), SIMPLIFY_TOL, max_n))
        n = max(len(r) for r in rings)
        rings = align([resample(r, n) for r in rings])
        blueprint[name] = {
            'joint': joint, 'colour': colour, 'axis': axis,
            'rings': [{'t': round(t, 4), 'pts': np.round(r, 4).tolist()} for t, r in zip(levels, rings)],
        }
        report.append(f'{name:10s} {len(levels)} rings × {n} corners')
    OUT.write_text(
        '// GENERATED by tools/blueprint/build_blueprint.py from assets/meshy/source/new-base-player.glb.\n'
        '// Do not edit by hand: change the segment table in the script and re-run it.\n'
        f'export const BLUEPRINT_VERSION = {VERSION};\n'
        f'export const MEDIUM_BLUEPRINT = {json.dumps(blueprint, separators=(",", ":"))};\n')
    print('\n'.join(report))
    print('wrote', OUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
