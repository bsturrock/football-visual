"""Orthographic reference renders of an unmodified GLB (Blender, read-only).

    python3 tools/inspect/render_views.py <file.glb> <out_prefix> [--res 700]

Writes <out_prefix>_{front,back,left,right,threequarter,top}.png plus a contact sheet.
Flat lighting + texture colour (Workbench). The GLB is imported into an empty
scene and never saved or exported. Front = looking at the model from +Z (glTF),
i.e. Blender -Y.
"""
import math, sys
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, prefix = args[0], args[1]
res = int(args[args.index('--res') + 1]) if '--res' in args else 700

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
c, size = (lo + hi) / 2, hi - lo
r = max(size)

s = bpy.context.scene
s.render.engine = 'BLENDER_WORKBENCH'
s.display.shading.light = 'FLAT'
s.display.shading.color_type = 'TEXTURE'
s.display.shading.show_backface_culling = False
s.render.resolution_x = s.render.resolution_y = res
s.render.film_transparent = False
s.world = bpy.data.worlds.new('w'); s.world.color = (0.8, 0.82, 0.85)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
s.collection.objects.link(cam); s.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = r * 1.1
cam.data.clip_end = r * 20

# Blender coords: glTF +Z (front) == Blender -Y, glTF +Y (up) == Blender +Z
views = {'front': (0, -1, 0), 'back': (0, 1, 0), 'left': (1, 0, 0), 'right': (-1, 0, 0),
         'threequarter': (0.6, -0.8, 0.25), 'top': (0, -0.0001, 1)}
out = []
for name, d in views.items():
    d = Vector(d).normalized()
    cam.location = c + d * r * 5
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    s.render.filepath = f'{prefix}_{name}.png'
    bpy.ops.render.render(write_still=True)
    out.append(s.render.filepath)
print('RENDERED', *out)
