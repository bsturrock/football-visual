"""Pre-rig cleanup for Meshy low-poly exports (run before Mixamo).

    python3 tools/blender/prep_for_rig.py in.glb out_basename [--height 1.93]

Writes out_basename.glb (preview) and out_basename.fbx (Mixamo upload).
- welds UV-seam splits so the mesh is one watertight piece (clean skin weights)
- flat shading, no normal map / metal-rough (matte facets)
- feet on the ground, centred, facing -Y (Blender front), scaled to --height metres
- base-colour texture kept (downsized to 1024) so Mixamo shows colours;
  colours get baked to vertex colours after rigging by stylize.py
"""
import bpy, bmesh, sys, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, out = argv[0], argv[1]
height = float(argv[argv.index('--height') + 1]) if '--height' in argv else 1.93

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
assert len(meshes) == 1, f'expected one mesh, got {len(meshes)}'
o = meshes[0]
for x in list(bpy.data.objects):
    if x is not o:
        bpy.data.objects.remove(x)
o.parent = None
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new()
bm.from_mesh(o.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = False
bm.to_mesh(o.data)
bm.free()

# scale to height, feet at z=0, centred in XY
bb = [Vector(c) for c in o.bound_box]
lo = Vector((min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb)))
hi = Vector((max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)))
s = height / (hi.z - lo.z)
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
o.data.transform(Matrix.Translation(-centre))
o.data.transform(Matrix.Scale(s, 4))
o.location = (0, 0, 0)
o.data.update()

# matte material: base colour only
mat = o.material_slots[0].material
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
base_name = bsdf.inputs['Base Color'].links[0].from_node.name
img = nt.nodes[base_name].image
for name in [n.name for n in nt.nodes]:
    n = nt.nodes[name]
    if (n.type == 'TEX_IMAGE' and name != base_name) or n.type in ('NORMAL_MAP', 'SEPARATE_COLOR'):
        nt.nodes.remove(n)
for im in list(bpy.data.images):
    if im != img:
        bpy.data.images.remove(im)
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 1.0
if img.size[0] > 1024:
    img.scale(1024, 1024)
img.filepath_raw = os.path.abspath(out + '_basecolor.png')
img.file_format = 'PNG'
img.save()
img.unpack(method='REMOVE') if img.packed_file else None
img.reload()
mat.name = 'Body'

bpy.context.view_layer.update()
print(f'tris: {sum(len(p.vertices) - 2 for p in o.data.polygons)}, '
      f'verts: {len(o.data.vertices)}, height: {o.dimensions.z:.3f} m')

bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', use_selection=True,
                          export_normals=True, export_apply=True)
bpy.ops.export_scene.fbx(filepath=out + '.fbx', use_selection=True, path_mode='COPY',
                         embed_textures=True, mesh_smooth_type='FACE', axis_forward='-Z', axis_up='Y')
