#!/usr/bin/env python3
"""Build the game helmet from the Meshy helmet (offline).

    python3 tools/blueprint/build_helmet.py [--preview out.png]

Reads   assets/meshy/source/new-base-helmet.glb      (never modified)
Writes  assets/characters/helmet_regions.glb

Approved changes only (Milestone 6): geometry is copied EXACTLY (same vertex positions, same
triangles, same UVs, same local frame). Material changes:
  - the 3 × 2048² textures (base colour, metal/roughness) become ONE 512² REGION MAP of the painted
    base colour: shell (white), stripe (blue), inner (grey). The game recolours it per team, so painted
    edges (the stripe crosses triangles) stay exactly where Meshy painted them.
  - the white facemask bars (same paint as the shell) are split off by geometry into their own
    primitive, coloured flat with the team's facemask colour.
  - metallic 1.0 → matte (set in the game material).
The script verifies that every source triangle appears once, with identical coordinates and UVs.
"""
import io, json, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/inspect'))
from inspect_glb import read_glb, accessor, node_matrix   # noqa: E402

SRC = ROOT / 'assets/meshy/source/new-base-helmet.glb'
OUT = ROOT / 'assets/characters/helmet_regions.glb'
MAP_SIZE = 512
# region-map palette (exact values; the game maps them to team colours)
PALETTE = {'shell': (255, 255, 255), 'stripe': (0, 0, 255), 'inner': (128, 128, 128)}


def texel_region(rgb):
    """Painted base colour → region. Saturated blue = stripe; neutral grey = pocket interior; else shell."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    stripe = (b > 150) & (r < 120)
    inner = ~stripe & ((r + g + b) / 3 < 215) & (np.abs(r - b) < 25)
    out = np.empty(rgb.shape[:2] + (3,), np.uint8)
    out[:] = PALETTE['shell']; out[stripe] = PALETTE['stripe']; out[inner] = PALETTE['inner']
    return out


def is_mask(c, white):
    """White bars in front of the face opening, below the visor line (helmet-local coords)."""
    return white and c[2] > 0.33 and c[1] < 0.0


def main():
    raw, g, binc = read_glb(SRC)
    nd = g['nodes'][g['scenes'][0]['nodes'][0]]
    M = node_matrix(nd)
    assert np.allclose(M, np.eye(4)), 'helmet node has a transform; handle it before copying'
    prim = g['meshes'][nd['mesh']]['primitives'][0]
    P = accessor(g, binc, prim['attributes']['POSITION'])
    T = accessor(g, binc, prim['indices']).reshape(-1, 3)
    UV = accessor(g, binc, prim['attributes']['TEXCOORD_0'])
    mat = g['materials'][prim['material']]
    tex = g['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
    bv = g['bufferViews'][g['images'][tex['source']]['bufferView']]
    o = bv.get('byteOffset', 0)
    img = np.asarray(Image.open(io.BytesIO(binc[o:o + bv['byteLength']])).convert('RGB')).astype(float)
    H, W = img.shape[:2]

    # region map: downsample the painted base colour, then classify each texel (crisp codes, no blending)
    small = np.asarray(Image.fromarray(img.astype(np.uint8)).resize((MAP_SIZE, MAP_SIZE), Image.LANCZOS)).astype(float)
    region_map = texel_region(small)
    # clean single-texel speckles along UV-island seams (majority of each 3×3 block)
    region_map = np.asarray(Image.fromarray(region_map).filter(ImageFilter.ModeFilter(3)))

    # mask triangles: white paint (centre texel) + position in front of the face below the visor
    body, mask = [], []
    for t in T:
        u, v = UV[t].mean(0)
        rgb = img[int(np.clip(v * H, 0, H - 1)), int(np.clip(u * W, 0, W - 1))]
        white = rgb.mean() >= 215
        (mask if is_mask(P[t].mean(0), white) else body).append(t)

    # exactness: body ∪ mask is the source triangle list (same vertices, same UVs)
    assert sorted(map(tuple, body + mask)) == sorted(map(tuple, T)), 'triangles changed!'
    regions = {'body': np.array(body), 'mask': np.array(mask)}

    # write GLB: primitive 'body' (POSITION + TEXCOORD_0, region map texture) and 'mask' (POSITION)
    png = io.BytesIO(); Image.fromarray(region_map).save(png, 'PNG'); png = png.getvalue()
    gltf = {'asset': {'version': '2.0', 'generator': 'build_helmet.py (from new-base-helmet.glb, geometry unchanged)'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'helmet'}],
            'meshes': [{'name': 'helmet', 'primitives': []}], 'materials': [], 'accessors': [], 'bufferViews': [],
            'samplers': [{'magFilter': 9729, 'minFilter': 9729}], 'images': [], 'textures': [], 'buffers': [{'byteLength': 0}]}
    blob = bytearray()
    def view(data, target=None):
        blob.extend(b'\0' * (-len(blob) % 4))
        bv = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        if target: bv['target'] = target
        gltf['bufferViews'].append(bv); blob.extend(data)
        return len(gltf['bufferViews']) - 1
    def acc(arr, typ):
        gltf['accessors'].append({'bufferView': view(arr.tobytes(), 34962), 'componentType': 5126, 'count': len(arr),
                                  'type': typ, 'min': arr.min(0).tolist(), 'max': arr.max(0).tolist()})
        return len(gltf['accessors']) - 1
    gltf['images'].append({'bufferView': view(png), 'mimeType': 'image/png'})
    gltf['textures'].append({'sampler': 0, 'source': 0})
    for name, tris in regions.items():
        idx = tris.reshape(-1)
        pos = P[idx].astype(np.float32)                               # exactly the source float32 values
        prim = {'attributes': {'POSITION': acc(pos, 'VEC3')}, 'mode': 4}
        mat = {'name': name, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.8}, 'doubleSided': True}
        if name == 'body':
            prim['attributes']['TEXCOORD_0'] = acc(UV[idx].astype(np.float32), 'VEC2')
            mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
        else:
            mat['pbrMetallicRoughness']['baseColorFactor'] = [0.95, 0.95, 0.97, 1]
        gltf['materials'].append(mat); prim['material'] = len(gltf['materials']) - 1
        gltf['meshes'][0]['primitives'].append(prim)
    blob.extend(b'\0' * (-len(blob) % 4))
    gltf['buffers'][0]['byteLength'] = len(blob)
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
    share = {k: int((region_map == v).all(-1).sum()) for k, v in PALETTE.items()}
    print(f'body {len(body)} + mask {len(mask)} = {len(T)} triangles | exact: yes | region texels {share} |',
          f'{OUT.relative_to(ROOT)} {OUT.stat().st_size // 1024} KB (source {len(raw) // 1024} KB)')
    if '--preview' in sys.argv:
        Image.fromarray(region_map).save(sys.argv[sys.argv.index('--preview') + 1])


if __name__ == '__main__':
    main()
