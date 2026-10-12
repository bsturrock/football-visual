"""
Milestone 2: rig the prepared base player.

    python3 characters/tools/rig_base.py -- characters/assets/base-medium.glb characters/assets/base-medium-rigged.glb

Builds a skeleton whose bone names match the game's procedural animator joints
(pelvis, spine, chest, neck, head, shL/elL/handL, shR/elR/handR, hipL/knL/ankL,
hipR/knR/ankR), places the joints on landmarks measured from the mesh, computes
skin weights automatically (bone heat), limits them to 4 per vertex and exports
a skinned GLB in the T-pose. +X is the player's left (same as the game).

Joint positions are in Blender coordinates (z up, front = -Y) and metres; they
match `JOINTS` in characters/src/PlayerRig.js (glTF: y up, front = +Z).
"""
import sys, bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, dst = args[0], args[1]

# landmarks (left side; right side mirrored). Measured from colour bands of base-medium.glb.
L = {
    'pelvis': (0.0, 0.0, 0.92),
    'spine':  (0.0, 0.0, 1.03),
    'chest':  (0.0, 0.0, 1.20),
    'neck':   (0.0, 0.0, 1.45),
    'head':   (0.0, 0.0, 1.53),
    'head_end': (0.0, 0.0, 1.80),
    'sh':     (0.30, 0.01, 1.365),
    'el':     (0.53, 0.01, 1.365),
    'hand':   (0.70, 0.01, 1.36),
    'hand_end': (0.90, 0.01, 1.35),
    'hip':    (0.11, 0.0, 0.89),
    'kn':     (0.155, 0.0, 0.53),
    'ank':    (0.18, 0.0, 0.15),
    'ank_end': (0.20, -0.17, 0.04),
}
BONES = [  # name, head, tail, parent, connected
    ('pelvis', 'pelvis', 'spine', None, False),
    ('spine', 'spine', 'chest', 'pelvis', True),
    ('chest', 'chest', 'neck', 'spine', True),
    ('neck', 'neck', 'head', 'chest', True),
    ('head', 'head', 'head_end', 'neck', True),
]
for s, k in ((1, 'L'), (-1, 'R')):
    BONES += [
        ('sh' + k, ('sh', s), ('el', s), 'chest', False),
        ('el' + k, ('el', s), ('hand', s), 'sh' + k, True),
        ('hand' + k, ('hand', s), ('hand_end', s), 'el' + k, True),
        ('hip' + k, ('hip', s), ('kn', s), 'pelvis', False),
        ('kn' + k, ('kn', s), ('ank', s), 'hip' + k, True),
        ('ank' + k, ('ank', s), ('ank_end', s), 'kn' + k, True),
    ]

def pos(key):
    if isinstance(key, tuple):
        x, y, z = L[key[0]]
        return Vector((x * key[1], y, z))
    return Vector(L[key])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
# the glTF importer splits flat-shaded triangles apart; weld so bone heat sees one surface
import bmesh
bm = bmesh.new(); bm.from_mesh(mesh.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(mesh.data); bm.free()
for p in mesh.data.polygons: p.use_smooth = False

arm_data = bpy.data.armatures.new('rig')
arm = bpy.data.objects.new('rig', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
for name, h, t, parent, conn in BONES:
    b = eb.new(name)
    b.head, b.tail = pos(h), pos(t)
    b.roll = 0
    if parent:
        b.parent = eb[parent]
        b.use_connect = conn
bpy.ops.object.mode_set(mode='OBJECT')

# automatic (heat) weights
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# max 4 influences, normalised; report unweighted vertices
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
unweighted = sum(1 for v in mesh.data.vertices if not any(g.weight > 1e-4 for g in v.groups))

# dominant bone per vertex (for a quick sanity report)
names = {g.index: g.name for g in mesh.vertex_groups}
count = {}
for v in mesh.data.vertices:
    if v.groups:
        g = max(v.groups, key=lambda g: g.weight)
        count[names[g.group]] = count.get(names[g.group], 0) + 1

bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_skins=True,
                          export_animations=False, export_normals=True, export_yup=True)
print('REPORT')
print(f'  bones          {len(arm_data.bones)}')
print(f'  unweighted     {unweighted} vertices')
print(f'  dominant bone  {dict(sorted(count.items()))}')
print(f'  wrote          {dst}')
