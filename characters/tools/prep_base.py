"""
Milestone 1: clean the medium base player and export it for Three.js.

    pip install bpy==4.2.0
    python3 characters/tools/prep_base.py -- characters/source/med-base-low-poly.glb characters/assets/base-medium.glb

The source file is never modified. Steps:
  - weld UV-seam vertex splits into one connected mesh (needed for skinning later)
  - facemask: replaced by the facemask from characters/source/helmet.glb (rest of the helmet kept);
    back of neck -> skin
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

# 1. facemask: the original helmet is kept as modelled; only its facemask is replaced by the one
#    from the provided helmet (characters/source/helmet.glb). The old cross bar + cage are painted
#    dark (they read as shadow behind the new bars, no holes cut), and the new facemask is fitted to
#    the old one's footprint (same width, front and bottom), coloured white.
WHITE_UV = ref_uv('white', lambda c: c.z > 0.8)
DARK_UV = ref_uv('dark', lambda c: c.z > 0.7 and c.y < 0)
OLD_MASK = dict(z0=0.585, z1=0.80, x1=0.16, y1=-0.10)
old_mask = [f for f in bm.faces if all(OLD_MASK['z0'] <= v.co.z <= OLD_MASK['z1'] and abs(v.co.x) <= OLD_MASK['x1']
                                       and v.co.y <= OLD_MASK['y1'] for v in f.verts)]
ov = {v for f in old_mask for v in f.verts}
old_lo = Vector([min(v.co[i] for v in ov) for i in range(3)])
old_hi = Vector([max(v.co[i] for v in ov) for i in range(3)])
for f in old_mask:
    for l in f.loops: l[uvl].uv = DARK_UV
# the outer sides of the face opening (where the new facemask meets the helmet) are white helmet,
# not shadow: anything dark there (old bars or dark paint) becomes white so no black slivers show
def is_side(c):
    ax = abs(c.x)
    if not (0.58 <= c.z <= 0.88 and c.y <= -0.08 and ax <= 0.2):
        return False
    if c.z < 0.62: return True                 # under the new facemask's bottom bar
    if c.z < 0.72: return ax >= 0.10           # lower cage: outer columns (where the mask joins the helmet)
    return ax >= 0.13                          # visor: side walls only, the opening stays dark
sides = [f for f in bm.faces if is_side(f.calc_center_median()) and (f in set(old_mask) or colour(f) == 'dark')]
for f in sides:
    for l in f.loops: l[uvl].uv = WHITE_UV

HELMET_SRC = os.path.join(os.path.dirname(os.path.abspath(src)), 'helmet.glb')
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=HELMET_SRC)
hobj = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
hm = bmesh.new(); hm.from_mesh(hobj.data)
bmesh.ops.remove_doubles(hm, verts=hm.verts, dist=1e-4)
mask_faces = [f for f in hm.faces if all(v.co.y < -0.38 and v.co.z < 0.12 for v in f.verts)]   # facemask (see README)
mv = {v for f in mask_faces for v in f.verts}
new_lo = Vector([min(v.co[i] for v in mv) for i in range(3)])
new_hi = Vector([max(v.co[i] for v in mv) for i in range(3)])
k = (old_hi.x - old_lo.x) / (new_hi.x - new_lo.x)                 # uniform scale: same width
MASK_FORWARD = 0.05                                              # sit just in front of the old (dark) bars
cx_new = (new_lo.x + new_hi.x) / 2
def place(co):
    # flip X so the mask's -X half (the one matching the reference) lands on +X, which the body
    # symmetry step keeps and mirrors
    return Vector((-(co.x - cx_new) * k, old_lo.y - MASK_FORWARD + (co.y - new_lo.y) * k, old_lo.z + (co.z - new_lo.z) * k))
vmap = {v: bm.verts.new(place(v.co)) for v in mv}
added = []
for f in mask_faces:
    nf = bm.faces.new([vmap[v] for v in reversed(f.verts)])      # reversed: X flip mirrors the winding
    for l in nf.loops: l[uvl].uv = WHITE_UV
    added.append(nf)
hm.free()
bpy.data.objects.remove(hobj, do_unlink=True)
for o in bpy.data.objects:
    o.select_set(o is obj)
bpy.context.view_layer.objects.active = obj
print(f'facemask: old {len(old_mask)} faces painted dark ({len(sides)} side faces white); new facemask {len(added)} faces, scale {k:.3f}, '
      f'z {old_lo.z + (new_lo.z - new_lo.z) * k:.3f}..{old_lo.z + (new_hi.z - new_lo.z) * k:.3f} (old {old_lo.z:.3f}..{old_hi.z:.3f})')

# 2. back of the neck: painted dark grey in the texture -> recolour as skin
neck = [f for f in bm.faces if 0.45 < f.calc_center_median().z < 0.64 and f.calc_center_median().y > -0.02
        and abs(f.calc_center_median().x) < 0.16 and colour(f) == 'dark']
for f in neck:
    for l in f.loops: l[uvl].uv = SKIN_UV
# 3. symmetry: keep one half (MIRROR_KEEP = +1 keeps +X, the player's left) and mirror it
KEEP = int(os.environ.get('MIRROR_KEEP', '1'))
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                       plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=(KEEP > 0), clear_outer=(KEEP < 0))
centre = [v for v in bm.verts if abs(v.co.x) < 1e-4]
for v in centre: v.co.x = 0.0
bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), axis='X', merge_dist=1e-4)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
print(f'symmetry: kept {"+X" if KEEP > 0 else "-X"} half, mirrored')
print(f'fixes: neck faces recoloured {len(neck)}')
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
