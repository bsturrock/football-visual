"""
Milestone 1: clean the medium base player and export it for Three.js.

    pip install bpy==4.2.0
    python3 characters/tools/prep_base.py -- characters/source/med-base-low-poly.glb characters/assets/base-medium.glb

The source file is never modified. Steps:
  - weld UV-seam vertex splits into one connected mesh (needed for skinning later)
  - consistent outward normals, flat shading
  - matte material: base colour only (drop the metallic/roughness map), texture <= 1024 px
  - real-world scale: 6'1" (1.854 m) to the top of the helmet
  - feet on the ground (y = 0), centred, facing +Z in glTF (Blender -Y)
Prints a report (triangles, size, non-manifold edges) for the acceptance check.
"""
import sys, os, bpy, bmesh
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
for f in bm.faces:
    f.smooth = False
non_manifold = [e for e in bm.edges if not e.is_manifold]
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
print(f'  non-manifold   {len(non_manifold)} edges {nm_report}')
print(f'  wrote          {dst} ({os.path.getsize(dst) / 1e6:.2f} MB)')
