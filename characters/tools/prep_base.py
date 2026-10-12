"""
Milestone 1: clean the medium base player and export it for Three.js.

    pip install bpy==4.2.0
    python3 characters/tools/prep_base.py -- characters/source/med-base-low-poly.glb characters/assets/base-medium.glb

The source file is never modified. Steps:
  - weld UV-seam vertex splits into one connected mesh (needed for skinning later)
  - fix the source: dark paint at the outer ends of the lower facemask -> white; dark panel behind
    the visor -> skin (a face shows through); back of neck -> skin
  - exact left/right symmetry: keep the +X half and mirror it (MIRROR_KEEP=-1 keeps -X)
  - consistent outward normals, flat shading
  - matte material: base colour only (drop the metallic/roughness map), texture <= 1024 px
  - real-world scale: 6'1" (1.854 m) to the top of the helmet
  - feet on the ground (y = 0), centred, facing +Z in glTF (Blender -Y)
Prints a report (triangles, size, non-manifold edges) for the acceptance check.
"""
import sys, os, colorsys, bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, dst = args[0], args[1]
HEIGHT_M = 1.854
TEX_MAX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
assert len(meshes) == 1, f'expected one mesh, found {len(meshes)}'
obj = meshes[0]
for o in list(bpy.data.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)
obj.parent = None
obj.name = obj.data.name = 'base_medium'
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- geometry -----------------------------------------------------------------
bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

# --- source fixes (coordinates are in the Meshy file's units, before scaling) ----
uvl = bm.loops.layers.uv.active
img0 = next(n.image for n in obj.material_slots[0].material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
TW, TH = img0.size
_px = np.empty(TW * TH * 4, dtype=np.float32)
img0.pixels.foreach_get(_px)
_px = _px.reshape(TH, TW, 4)

def face_uv(f):
    return sum((l[uvl].uv for l in f.loops), Vector((0, 0))) / len(f.loops)

def colour(f):
    u = face_uv(f)
    r, g, b = _px[min(TH - 1, max(0, int(u.y * TH))), min(TW - 1, max(0, int(u.x * TW))), :3]
    h, s, v = colorsys.rgb_to_hsv(float(r), float(g), float(b))
    if v < 0.3: return 'dark'
    if s < 0.25: return 'white'
    if 0.5 < h < 0.75: return 'blue'
    return 'skin'

def ref_uv(kind, where):
    """Texture coordinate of the largest face of a colour in a region (a solid colour sample)."""
    cands = [f for f in bm.faces if where(f.calc_center_median()) and colour(f) == kind]
    return face_uv(max(cands, key=lambda f: f.calc_area())).copy()

SKIN_UV = ref_uv('skin', lambda c: 0.45 < c.z < 0.62 and c.y < 0 and abs(c.x) < 0.12)

# 1. facemask: faces at the outer ends of the lower mask (where it joins the helmet) are painted
#    dark in the texture and read as holes -> recolour white. Geometry is left as modelled.
WHITE_UV = ref_uv('white', lambda c: c.z > 0.8)
mask_dark = [f for f in bm.faces
             if 0.07 <= f.calc_center_median().x <= 0.17 and 0.58 <= f.calc_center_median().z <= 0.74
             and -0.2 <= f.calc_center_median().y <= -0.05 and colour(f) == 'dark']
for f in mask_dark:
    for l in f.loops: l[uvl].uv = WHITE_UV

# 2. face: behind the visor and the lower mask there is only a dark back panel. Paint the
#    front-facing parts skin so a face reads through the openings (side walls stay dark = shadow).
face = [f for f in bm.faces
        if 0.64 <= f.calc_center_median().z <= 0.84 and abs(f.calc_center_median().x) <= 0.12
        and f.calc_center_median().y > -0.16 and f.normal.y < -0.85 and colour(f) == 'dark']
for f in face:
    for l in f.loops: l[uvl].uv = SKIN_UV

# 3. back of the neck: painted dark grey in the texture -> recolour as skin
neck = [f for f in bm.faces if 0.45 < f.calc_center_median().z < 0.64 and f.calc_center_median().y > -0.02
        and abs(f.calc_center_median().x) < 0.16 and colour(f) == 'dark']
for f in neck:
    for l in f.loops: l[uvl].uv = SKIN_UV
# 4. symmetry: keep one half (MIRROR_KEEP = +1 keeps +X, the player's left) and mirror it
KEEP = int(os.environ.get('MIRROR_KEEP', '1'))
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                       plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=(KEEP > 0), clear_outer=(KEEP < 0))
centre = [v for v in bm.verts if abs(v.co.x) < 1e-4]
for v in centre: v.co.x = 0.0
bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), axis='X', merge_dist=1e-4)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
print(f'symmetry: kept {"+X" if KEEP > 0 else "-X"} half, mirrored')
print(f'fixes: facemask dark faces -> white {len(mask_dark)}; face panel -> skin {len(face)}; neck faces recoloured {len(neck)}')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = False
non_manifold = [e for e in bm.edges if len(e.link_faces) > 2]
nm_report = [tuple(round(c, 3) for c in (e.verts[0].co + e.verts[1].co) / 2) for e in non_manifold]
bm.to_mesh(obj.data)
bm.free()

# scale to height, feet at z=0, centred on x/y
lo = Vector((min(v.co.x for v in obj.data.vertices), min(v.co.y for v in obj.data.vertices), min(v.co.z for v in obj.data.vertices)))
hi = Vector((max(v.co.x for v in obj.data.vertices), max(v.co.y for v in obj.data.vertices), max(v.co.z for v in obj.data.vertices)))
s = HEIGHT_M / (hi.z - lo.z)
obj.data.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
obj.data.transform(Matrix.Scale(s, 4))
obj.data.update()

# facing check: the facemask (front) should be toward -Y in Blender (= +Z in glTF)
head = [v.co for v in obj.data.vertices if v.co.z > HEIGHT_M * 0.85]
front_y = min(c.y for c in head)
back_y = max(c.y for c in head)
assert abs(front_y) > abs(back_y) * 0.8, 'unexpected facing; check the source orientation'

# --- material -------------------------------------------------------------------
mat = obj.material_slots[0].material
mat.name = 'body'
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
base_node = bsdf.inputs['Base Color'].links[0].from_node.name
img = nt.nodes[base_node].image
for name in [n.name for n in nt.nodes]:
    n = nt.nodes[name]
    if n.type in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL') or name == base_node:
        continue
    nt.nodes.remove(n)
for im in list(bpy.data.images):
    if im != img:
        bpy.data.images.remove(im)
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 1.0
if img.size[0] > TEX_MAX:
    img.scale(TEX_MAX, TEX_MAX)
img.name = 'body_basecolor'
img.file_format = 'PNG'
img.pack()

os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True,
                          export_normals=True, export_yup=True, export_apply=True)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
dims = obj.dimensions
print('REPORT')
print(f'  triangles      {tris}')
print(f'  vertices       {len(obj.data.vertices)} (welded)')
print(f'  size (m)       width {dims.x:.3f}  depth {dims.y:.3f}  height {dims.z:.3f}')
print(f'  texture        {img.size[0]}x{img.size[1]}')
print(f'  bad edges      {len(non_manifold)} (shared by 3+ faces) {nm_report}')
print(f'  wrote          {dst} ({os.path.getsize(dst) / 1e6:.2f} MB)')
