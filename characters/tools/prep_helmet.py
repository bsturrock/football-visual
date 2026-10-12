"""
Prepare the separate helmet (with its own facemask) for the player.

    python3 characters/tools/prep_helmet.py -- characters/source/helmet.glb characters/assets/helmet.glb

The source is never modified. Steps:
  - weld, consistent normals, flat shading, matte base-colour texture (<= 1024 px)
  - exact left/right symmetry: keep one half and mirror it (HELMET_KEEP=-1 keeps -X, the default: its facemask matches the reference)
  - otherwise the helmet is used exactly as modelled (the provided mesh is the reference)
  - scaled and positioned to replace the helmet on base-medium.glb (same width, same bottom, same front)
  - output in metres, glTF y up, facing +Z, origin at the head joint (attach it to the head bone)
"""
import sys, os, bpy, bmesh
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, dst = args[0], args[1]
KEEP = int(os.environ.get('HELMET_KEEP', '-1'))
TEX_MAX = 1024
FRONT_Y = -0.55          # source units: everything in front of this is facemask / brim
# target (base-medium.glb helmet, metres, Blender coords: z up, front -Y) and the head joint
TARGET = {'width': 0.36, 'bottom_z': 1.48, 'front_y': -0.18}
HEAD_JOINT = Vector((0.0, 0.0, 1.53))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.data.objects if o.type == 'MESH')
for o in list(bpy.data.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)
obj.parent = None
obj.name = obj.data.name = 'helmet'
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)

# --- symmetry -----------------------------------------------------------------------
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                       plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=(KEEP > 0), clear_outer=(KEEP < 0))
for v in bm.verts:
    if abs(v.co.x) < 1e-4: v.co.x = 0.0
bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), axis='X', merge_dist=1e-4)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces: f.smooth = False
bad = [e for e in bm.edges if len(e.link_faces) > 2]
bm.to_mesh(obj.data)
bm.free()

# --- fit to the body's helmet ---------------------------------------------------------
vs = [v.co for v in obj.data.vertices]
lo = Vector([min(v[i] for v in vs) for i in range(3)])
hi = Vector([max(v[i] for v in vs) for i in range(3)])
shell = [v for v in vs if v.y >= FRONT_Y]
half = max(abs(v.x) for v in shell)
shell_w = 2 * max(abs(v.x) for v in shell if abs(v.x) < half * 0.92)  # shell, ear pads excluded
s = TARGET['width'] / shell_w
obj.data.transform(Matrix.Scale(s, 4))
vs = [v.co for v in obj.data.vertices]
bottom = min(v.z for v in vs)
front = min(v.y for v in vs)
obj.data.transform(Matrix.Translation(Vector((0, TARGET['front_y'] - front, TARGET['bottom_z'] - bottom))))
obj.data.transform(Matrix.Translation(-HEAD_JOINT))     # origin at the head joint
obj.data.update()

# --- material -------------------------------------------------------------------------
mat = obj.material_slots[0].material
mat.name = 'helmet'
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
img.name = 'helmet_basecolor'
img.file_format = 'PNG'
img.pack()

os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True,
                          export_normals=True, export_yup=True, export_apply=True)
d = obj.dimensions
print('REPORT')
print(f'  triangles   {sum(len(p.vertices) - 2 for p in obj.data.polygons)}')
print(f'  size (m)    width {d.x:.3f}  depth {d.y:.3f}  height {d.z:.3f}')
print(f'  bad edges   {len(bad)}')
print(f'  wrote       {dst} ({os.path.getsize(dst) / 1e6:.2f} MB)')
