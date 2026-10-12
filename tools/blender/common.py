import bpy, bmesh, numpy as np
from mathutils import Vector

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.lower().startswith('icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    return arm, mesh

def tex_array(mesh):
    mat = mesh.data.materials[0]
    img = None
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE': img = n.image; break
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
    return px.reshape(h, w, 4), w, h

def face_colors(mesh, px, w, h):
    me = mesh.data
    uvl = me.uv_layers.active.data
    cols = []
    for p in me.polygons:
        acc = np.zeros(3); n = 0
        uvs = [uvl[li].uv for li in p.loop_indices]
        cu = sum((u for u in uvs), Vector((0, 0))) / len(uvs)
        for u in uvs + [cu, cu, cu]:
            # sample slightly toward the centroid to avoid seams
            uu = u * 0.6 + cu * 0.4
            x = min(w - 1, max(0, int(uu.x * w))); y = min(h - 1, max(0, int(uu.y * h)))
            acc += px[y, x, :3]; n += 1
        cols.append(acc / n)
    return np.array(cols)  # linear RGB
