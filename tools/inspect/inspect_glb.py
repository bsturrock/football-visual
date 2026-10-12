#!/usr/bin/env python3
"""Read-only GLB inspector (Milestone 1).

    python3 tools/inspect/inspect_glb.py <file.glb> <out.json> [--texture-out dir]

Parses the GLB directly (no Blender, no re-export) and reports what is actually
in the file: hierarchy, transforms, bounds, triangle/vertex counts, materials,
connected parts, open/non-manifold edges, bilateral symmetry, per-height
cross-section profiles, and the texture colour of every triangle. Never writes
to the input file.
"""
import hashlib, io, json, struct, sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, _ = struct.unpack_from('<III', raw, 0)
    assert magic == 0x46546C67 and version == 2, 'not a glTF 2.0 binary'
    off, gltf, binc = 12, None, b''
    while off < len(raw):
        ln, typ = struct.unpack_from('<II', raw, off)
        chunk = raw[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A: gltf = json.loads(chunk)
        elif typ == 0x004E4942: binc = chunk
        off += 8 + ln
    return raw, gltf, binc


def accessor(g, binc, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    n, dt = NCOMP[a['type']], COMP[a['componentType']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0)
    item = n * np.dtype(dt).itemsize
    if stride and stride != item:
        rows = [np.frombuffer(binc, dt, n, start + k * stride) for k in range(a['count'])]
        arr = np.stack(rows)
    else:
        arr = np.frombuffer(binc, dt, a['count'] * n, start).reshape(a['count'], n)
    return arr.astype(np.float64) if dt == np.float32 else arr.astype(np.int64)


def node_matrix(nd):
    if 'matrix' in nd: return np.array(nd['matrix'], float).reshape(4, 4).T
    t = np.array(nd.get('translation', [0, 0, 0]), float)
    x, y, z, w = nd.get('rotation', [0, 0, 0, 1])
    s = np.array(nd.get('scale', [1, 1, 1]), float)
    R = np.array([[1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                  [2*(x*y+z*w), 1 - 2*(x*x+z*z), 2*(y*z-x*w)],
                  [2*(x*z-y*w), 2*(y*z+x*w), 1 - 2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R * s; M[:3, 3] = t
    return M


def components(n, edges):
    parent = list(range(n))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb: parent[ra] = rb
    return [find(i) for i in range(n)]


def hexc(c): return '#%02x%02x%02x' % tuple(int(v) for v in c)


def analyse_primitive(g, binc, prim, M, images, weld_tol):
    pos = accessor(g, binc, prim['attributes']['POSITION'])
    idx = accessor(g, binc, prim['indices']).ravel() if 'indices' in prim else np.arange(len(pos))
    tris = idx.reshape(-1, 3)
    P = (np.c_[pos, np.ones(len(pos))] @ M.T)[:, :3]

    # weld coincident vertices (UV/normal seams split them) to find real topology
    key = np.round(P / weld_tol).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    wt = weld[tris]
    degenerate = int(((wt[:, 0] == wt[:, 1]) | (wt[:, 1] == wt[:, 2]) | (wt[:, 0] == wt[:, 2])).sum())

    edge_count = Counter()
    for a, b, c in wt:
        for e in ((a, b), (b, c), (c, a)):
            edge_count[tuple(sorted(e))] += 1
    boundary = sum(1 for v in edge_count.values() if v == 1)
    nonmanifold = sum(1 for v in edge_count.values() if v > 2)

    comp = components(weld.max() + 1, edge_count.keys())
    tri_comp = np.array([comp[a] for a in wt[:, 0]])
    parts = Counter(tri_comp.tolist())

    # symmetry: mirror every welded vertex in X and find its nearest partner
    W = np.zeros((weld.max() + 1, 3)); W[weld] = P
    mir = W * [-1, 1, 1]
    d = np.sqrt(((mir[:, None, :] - W[None, :, :]) ** 2).sum(-1)).min(1) if len(W) < 8000 else None

    # per-triangle texture colour (sampled at the triangle's UV centroid)
    tri_colours = None
    mat = g['materials'][prim['material']] if 'material' in prim else None
    tex_i = mat and mat.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
    if tex_i is not None and 'TEXCOORD_0' in prim['attributes']:
        img = images[g['textures'][tex_i]['source']]
        uv = accessor(g, binc, prim['attributes']['TEXCOORD_0'])
        c = uv[tris].mean(1)
        px = np.clip((c[:, 0] % 1) * img.width, 0, img.width - 1).astype(int)
        py = np.clip((c[:, 1] % 1) * img.height, 0, img.height - 1).astype(int)
        arr = np.asarray(img.convert('RGB'))
        tri_colours = arr[py, px]

    lo, hi = P.min(0), P.max(0)
    return dict(P=P, tris=tris, wt=wt, tri_comp=tri_comp, tri_colours=tri_colours, report={
        'vertices': int(len(pos)), 'welded_vertices': int(weld.max() + 1), 'triangles': int(len(tris)),
        'degenerate_triangles': degenerate, 'open_boundary_edges': boundary, 'non_manifold_edges': nonmanifold,
        'watertight': boundary == 0 and nonmanifold == 0,
        'connected_parts': len(parts),
        'largest_parts_triangles': [n for _, n in parts.most_common(12)],
        'bounds_min': lo.round(4).tolist(), 'bounds_max': hi.round(4).tolist(), 'size': (hi - lo).round(4).tolist(),
        'mirror_x': None if d is None else {
            'max_mismatch': round(float(d.max()), 4), 'mean_mismatch': round(float(d.mean()), 5),
            'vertices_within_1mm': round(float((d < 0.001).mean()), 3),
            'vertices_within_5mm': round(float((d < 0.005).mean()), 3)},
    })


def colour_clusters(cols, areas, k_tol=40):
    """Greedy palette: merge triangle colours within k_tol (RGB distance), weighted by area."""
    order = np.argsort(-areas)
    centres, weights, label = [], [], np.zeros(len(cols), int)
    for i in order:
        c = cols[i].astype(float)
        for j, ct in enumerate(centres):
            if np.linalg.norm(ct - c) < k_tol:
                label[i] = j; weights[j] += areas[i]; break
        else:
            centres.append(c); weights.append(areas[i]); label[i] = len(centres) - 1
    return np.array(centres), np.array(weights), label


def main():
    src, out = sys.argv[1], sys.argv[2]
    raw, g, binc = read_glb(src)
    images = []
    for im in g.get('images', []):
        bv = g['bufferViews'][im['bufferView']]
        o = bv.get('byteOffset', 0)
        images.append(Image.open(io.BytesIO(binc[o:o + bv['byteLength']])))

    # walk the scene graph
    nodes_out, prims = [], []
    def walk(i, parentM, depth):
        nd = g['nodes'][i]
        M = parentM @ node_matrix(nd)
        nodes_out.append({'index': i, 'name': nd.get('name'), 'depth': depth, 'mesh': nd.get('mesh'),
                          'skin': nd.get('skin'), 'local_matrix_is_identity': bool(np.allclose(node_matrix(nd), np.eye(4))),
                          'world_translation': M[:3, 3].round(4).tolist()})
        if 'mesh' in nd:
            for pi, p in enumerate(g['meshes'][nd['mesh']]['primitives']):
                prims.append((nd.get('name') or f'node{i}', pi, p, M))
        for c in nd.get('children', []): walk(c, M, depth + 1)
    for r in g['scenes'][g.get('scene', 0)]['nodes']: walk(r, np.eye(4), 0)

    results = [analyse_primitive(g, binc, p, M, images, 1e-5) for _, _, p, M in prims]
    P = np.vstack([r['P'] for r in results])
    lo, hi = P.min(0), P.max(0)
    H = hi[1] - lo[1]

    # cross-section profile along height: X and Z extent of the geometry in each band
    bands = []
    for k in range(40):
        y0, y1 = lo[1] + H * k / 40, lo[1] + H * (k + 1) / 40
        sel = P[(P[:, 1] >= y0) & (P[:, 1] < y1)]
        if len(sel):
            bands.append({'y_from_floor': round(float((y0 + y1) / 2 - lo[1]), 4),
                          'x_min': round(float(sel[:, 0].min()), 4), 'x_max': round(float(sel[:, 0].max()), 4),
                          'z_min': round(float(sel[:, 2].min()), 4), 'z_max': round(float(sel[:, 2].max()), 4)})

    # colour palette with location of each colour region
    palette = []
    for r in results:
        if r['tri_colours'] is None: continue
        T = r['P'][r['tris']]
        areas = 0.5 * np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
        cen, w, lab = colour_clusters(r['tri_colours'], areas)
        cent = T.mean(1)
        for j in np.argsort(-w)[:16]:
            m = lab == j
            pc = cent[m]
            palette.append({'colour': hexc(cen[j]), 'area_share': round(float(w[j] / w.sum()), 4), 'triangles': int(m.sum()),
                            'y_range_from_floor': [round(float(pc[:, 1].min() - lo[1]), 3), round(float(pc[:, 1].max() - lo[1]), 3)],
                            'x_range': [round(float(pc[:, 0].min()), 3), round(float(pc[:, 0].max()), 3)],
                            'z_range': [round(float(pc[:, 2].min()), 3), round(float(pc[:, 2].max()), 3)]})

    report = {
        'file': src, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
        'generator': g.get('asset', {}).get('generator'),
        'counts': {k: len(g.get(k, [])) for k in ('scenes', 'nodes', 'meshes', 'materials', 'textures', 'images', 'skins', 'animations')},
        'nodes': nodes_out,
        'materials': [{'name': m.get('name'), 'pbr': m.get('pbrMetallicRoughness'), 'doubleSided': m.get('doubleSided', False),
                       'alphaMode': m.get('alphaMode', 'OPAQUE')} for m in g.get('materials', [])],
        'images': [{'mime': im.get('mimeType'), 'size': list(images[i].size)} for i, im in enumerate(g.get('images', []))],
        'primitives': [dict(node=n, primitive=pi, **r['report']) for (n, pi, _, _), r in zip(prims, results)],
        'world': {'units_assumed': 'metres (glTF spec)', 'up': '+Y (glTF spec)',
                  'bounds_min': lo.round(4).tolist(), 'bounds_max': hi.round(4).tolist(), 'size': (hi - lo).round(4).tolist(),
                  'floor_y': round(float(lo[1]), 4), 'height': round(float(H), 4),
                  'height_ft_in': f"{int(H / 0.3048)}'{(H / 0.0254) % 12:.1f}\""},
        'height_profile': bands,
        'colour_regions': palette,
        'notes': [],
    }
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ('counts', 'world', 'primitives')}, indent=1))


if __name__ == '__main__':
    main()
