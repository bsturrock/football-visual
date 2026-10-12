"""
Stylize a Meshy + Mixamo football player into the reference low-poly look.

  python3 stylize.py in.glb out.glb [--kit line|big|skill|qb] [--ratio 1.0] [--dissolve 3]

Pipeline
 1. optional collapse-decimate (X-symmetric) for larger facets
 2. per-face colour class from the baked texture (rule-based: white / blue / dark / skin)
 3. body part per face from Mixamo bone landmarks
 4. limbs: symmetric 1-D band segmentation along the limb axis → bisect at each
    boundary so every colour change sits on a clean edge ring; kit-driven bands
    (gloves / wristbands) are cut from bone positions
 5. single pant stripe from geometry (outward-facing thigh faces, cut planes)
 6. optional limited dissolve (delimited by material) → large flat faces
 7. one matte material per region, named, so team colours swap at runtime
Skin weights survive (bmesh interpolates deform layers on split).
"""
import sys, math
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import bpy, bmesh, numpy as np
from mathutils import Vector
from common import load, tex_array

args = sys.argv[1:]
src, dst = args[0], args[1]
opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
kit = opt('--kit', 'line'); ratio = opt('--ratio', 1.0); dissolve = opt('--dissolve', 0.0)

PALETTE = {
    'jersey': '#1f56d8', 'pants': '#f2f4f7', 'stripe': '#1f56d8', 'socks': '#1f56d8', 'band': '#f2f4f7',
    'helmet': '#f2f3f6', 'mask': '#f2f3f6', 'facehole': '#18213a', 'skin': '#b87a50',
    'gloves': '#2a2e38', 'wrist': '#1f56d8', 'cleats': '#262a35',
}
if kit == 'skill': PALETTE.update(cleats='#1f56d8', gloves='#1f56d8', mask='#1f56d8')
if kit == 'qb': PALETTE.update(cleats='#1f56d8', gloves='#b87a50', mask='#f2f3f6')
REGIONS = list(PALETTE); RID = {r: i for i, r in enumerate(REGIONS)}

arm, obj = load(src)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
if arm.animation_data: arm.animation_data_clear()
B = lambda n: arm.matrix_world @ arm.data.bones['mixamorig:' + n].head_local
L = {n: B(n) for n in ['Hips', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightHand',
                       'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg']}

# ------------------------------------------------------------ 1. decimate (optional)
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
if ratio < 0.999:
    mod = obj.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio; mod.use_symmetry = True; mod.symmetry_axis = 'X'
    while obj.modifiers[0] != mod: bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)

# ------------------------------------------------------------ 2. colour class
px, W, H = tex_array(obj)
M = obj.matrix_world; Minv = M.inverted(); R3 = Minv.to_3x3()
bm = bmesh.new(); bm.from_mesh(obj.data)
uv = bm.loops.layers.uv.active

def srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, 1), 1 / 2.4) - 0.055)
def classify(f):
    cu = Vector((0, 0))
    for l in f.loops: cu += l[uv].uv
    cu /= len(f.loops)
    acc = np.zeros(3); n = 0
    pts = [cu] * 3 + [l[uv].uv * 0.4 + cu * 0.6 for l in f.loops]
    for u in pts:
        x = min(W - 1, max(0, int(u.x * W))); y = min(H - 1, max(0, int(u.y * H)))
        acc += px[y, x, :3]; n += 1
    r, g, b = srgb(acc / n)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    if b > r + 0.18 and b > g + 0.05: return 'navy' if lum < 0.3 else 'blue'
    if lum < 0.3: return 'dark'
    if r > b + 0.12 and r > g + 0.03: return 'skin'
    return 'white'

C = lambda f: M @ f.calc_center_median()
neckZ, hipZ = L['Neck'].z, L['Hips'].z
legTop = (L['LeftUpLeg'].z + hipZ) / 2 - 0.02
shX = abs(L['LeftArm'].x)
def part_of(c):
    if c.z > neckZ + 0.015 and abs(c.x) < 0.17: return 'head'
    if abs(c.x) > shX + 0.05 and c.z > L['Spine2'].z - 0.08: return 'armL' if c.x > 0 else 'armR'
    if c.z < legTop and abs(c.x) > 0.012: return 'legL' if c.x > 0 else 'legR'
    if c.z < legTop: return 'crotch'
    return 'torso'

def limb_axis(part):
    s = 1 if part.endswith('L') else -1
    if part.startswith('leg'): return Vector((0, 0, 0)), Vector((0, 0, 1))
    a = L['LeftArm']; h = L['LeftHand']
    a = Vector((a.x * s, a.y, a.z)); h = Vector((h.x * s, h.y, h.z))
    return a, (h - a).normalized()

def segment(ts, labels, binw=0.01, minlen=0.025):
    lo, hi = min(ts), max(ts); nb = max(1, int(math.ceil((hi - lo) / binw)))
    bins = [dict() for _ in range(nb)]
    for t, l in zip(ts, labels):
        i = min(nb - 1, int((t - lo) / binw)); bins[i][l] = bins[i].get(l, 0) + 1
    maj = [max(b, key=b.get) if b else None for b in bins]
    for i in range(nb):
        if maj[i] is None: maj[i] = maj[i - 1] if i else next(m for m in maj if m)
    runs = []
    for i, m in enumerate(maj):
        if runs and runs[-1][2] == m: runs[-1][1] = i + 1
        else: runs.append([i, i + 1, m])
    while len(runs) > 1:
        k = min(range(len(runs)), key=lambda i: runs[i][1] - runs[i][0])
        if (runs[k][1] - runs[k][0]) * binw >= minlen: break
        r = runs.pop(k)
        if k == 0: runs[0][0] = r[0]
        elif k == len(runs): runs[-1][1] = r[1]
        else:
            a, b = runs[k - 1], runs[k]
            if a[1] - a[0] >= b[1] - b[0]: a[1] = r[1]
            else: b[0] = r[0]
        merged = []
        for q in runs:
            if merged and merged[-1][2] == q[2]: merged[-1][1] = q[1]
            else: merged.append(q)
        runs = merged
    return [(lo + r[0] * binw, lo + r[1] * binw, r[2]) for r in runs]

def cut(part_names, co_w, no_w, pred=None):
    fs = [f for f in bm.faces if part_of(C(f)) in part_names and (pred is None or pred(f))]
    if not fs: return
    es = list({e for f in fs for e in f.edges}); vs = list({v for f in fs for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=vs + es + fs, plane_co=Minv @ co_w, plane_no=(R3 @ no_w).normalized(), dist=0.0004)

def tri(): bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])

# ------------------------------------------------------------ 4. limb bands (symmetric)
limb = {}
for kind in ('leg', 'arm'):
    ts, labs = [], []
    for side in 'LR':
        o, ax = limb_axis(kind + side)
        for f in bm.faces:
            c = C(f)
            if part_of(c) == kind + side:
                ts.append((c - o).dot(ax)); labs.append(classify(f))
    labs = [('dark' if l == 'navy' else l) for l in labs]
    segs = segment(ts, labs, 0.01, 0.025 if kind == 'leg' else 0.02)
    print(kind, [(round(a, 3), round(b, 3), l) for a, b, l in segs])
    limb[kind] = segs

footZ = L['LeftFoot'].z
def leg_region(label, idx, segs):
    top_white = max((i for i, q in enumerate(segs) if q[2] == 'white'), default=len(segs) - 1)
    sock = max((i for i, q in enumerate(segs) if q[2] == 'blue' and i < top_white), key=lambda i: segs[i][1] - segs[i][0], default=None)
    if segs[idx][1] <= footZ + 0.035 or label == 'dark': return 'cleats'
    if sock is not None and idx < sock and label == 'blue': return 'cleats'
    if idx >= top_white: return 'pants'
    if label == 'blue': return 'socks'
    if label == 'skin': return 'skin'
    return 'band'
def _unused(label, idx, segs):
    if label == 'dark' or (label == 'white' and any(s[2] == 'dark' for s in segs[idx + 1:])): return 'cleats'
    if label == 'blue': return 'socks'
    if label == 'white':
        below_sock = any(s[2] == 'blue' for s in segs[idx + 1:])
        return 'band' if below_sock else 'pants'
    return 'skin'

# legs: cut at every boundary
legsegs = limb['leg']
for a, b, l in legsegs[:-1]:
    cut(('legL', 'legR'), Vector((0, 0, b)), Vector((0, 0, 1)))
tri()

# arms: sleeve boundary from texture; gloves / wrist bands from the hand bone (kit)
armsegs = limb['arm']
o, ax = limb_axis('armL')
tHand = (L['LeftHand'] - o).dot(ax)
sleeve_end = next((b for a, b, l in armsegs if l == 'blue'), None)
arm_bounds = []
if sleeve_end: arm_bounds.append((sleeve_end, 'sleeve'))
tex_bands = [(b, l) for a, b, l in armsegs[:-1]]
has_tex_gloves = any(l == 'dark' for a, b, l in armsegs) or (len(armsegs) > 2 and armsegs[-1][2] == 'blue')
gl0 = next((a for a, b, l in armsegs if l == 'dark'), tHand - 0.015)
if has_tex_gloves: arm_bounds = [(b, l) for b, l in tex_bands]
else: arm_bounds += [(gl0 - 0.075, 'wrist0'), (gl0 - 0.035, 'wrist1'), (gl0, 'glove')]
for t, _ in arm_bounds:
    for side in 'LR':
        o2, ax2 = limb_axis('arm' + side)
        cut(('arm' + side,), o2 + ax2 * t, ax2)
tri()

# torso hem
tf = [f for f in bm.faces if part_of(C(f)) == 'torso']
hs = segment([C(f).z for f in tf], [('white' if classify(f) == 'white' else 'blue') for f in tf], 0.01, 0.04)
hem = next((b for a, b, l in hs if l == 'white'), legTop + 0.06)
print('hem', round(hem, 3))
cut(('torso', 'crotch', 'legL', 'legR'), Vector((0, 0, hem)), Vector((0, 0, 1)))
tri()

# ------------------------------------------------------------ 5. stripe (one clean strip on the outer thigh)
kneeZ = L['LeftLeg'].z
pant_lo = legsegs[max((i for i, q in enumerate(legsegs) if q[2] == 'white'), default=len(legsegs) - 1)][0]
def is_pants_face(f):
    c = C(f); return c.z > pant_lo and c.z < hem
STRIPE_HALF = 0.032
for side in (1, -1):
    hipx = L['LeftUpLeg'].x * side
    for sgn in (1, -1):  # two planes bounding the stripe, in front/behind the outer meridian (y)
        cut(('legL' if side > 0 else 'legR', 'torso'), Vector((hipx, sgn * STRIPE_HALF, 0)), Vector((0, 1, 0)), pred=lambda f: is_pants_face(f) and C(f).x * side > 0)
tri()

# ------------------------------------------------------------ region assignment
bm.faces.ensure_lookup_table()
# mesh islands → facemask cage is a separate small piece in front of the face
island = {}
comp_id = 0; comp_size = {}; comp_front = {}
for f0 in bm.faces:
    if f0.index in island: continue
    stack = [f0]; members = []
    while stack:
        g = stack.pop()
        if g.index in island: continue
        island[g.index] = comp_id; members.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in island: stack.append(h)
    cs = [C(g) for g in members]
    comp_size[comp_id] = len(members)
    comp_front[comp_id] = (sum(c.y for c in cs) / len(cs) < L['Head'].y - 0.05 and sum(c.z for c in cs) / len(cs) > L['Neck'].z)
    comp_id += 1
big = max(comp_size, key=comp_size.get)
def is_mask(f):
    i = island[f.index]
    return i != big and comp_size[i] < 400 and comp_front[i]
print('islands', comp_id, 'mask faces', sum(1 for f in bm.faces if is_mask(f)))
regions = {}
for f in bm.faces:
    c = C(f); p = part_of(c); lab = classify(f)
    if p.startswith('leg') or (p in ('torso', 'crotch') and c.z < hem):
        if c.z >= pant_lo or p in ('torso', 'crotch'):
            reg = 'pants'
            n = (M.to_3x3() @ f.normal).normalized()
            side = 1 if c.x > 0 else -1
            if abs(c.y - L['Hips'].y) < STRIPE_HALF and n.x * side > 0.35 and c.z > kneeZ + 0.04 and abs(c.x) > 0.1:
                reg = 'stripe'
        else:
            idx = next((i for i, s in enumerate(legsegs) if s[0] - 1e-4 <= c.z <= s[1] + 1e-4), 0 if c.z < legsegs[0][0] else len(legsegs) - 1)
            reg = leg_region(legsegs[idx][2], idx, legsegs)

    elif p.startswith('arm'):
        o2, ax2 = limb_axis(p); t = (c - o2).dot(ax2)
        if has_tex_gloves:
            i = next((i for i, q in enumerate(armsegs) if q[0] - 1e-4 <= t <= q[1] + 1e-4), 0 if t < armsegs[0][0] else len(armsegs) - 1)
            l2 = armsegs[i][2]
            first_skin = next((k for k, q in enumerate(armsegs) if q[2] == 'skin'), 0)
            last = len(armsegs) - 1
            if l2 == 'dark' or (i == last and l2 == 'blue'): reg = 'gloves'
            elif l2 == 'skin': reg = 'skin'
            elif l2 == 'white': reg = 'band'
            else: reg = 'jersey' if i < first_skin else 'wrist'
        elif t >= gl0: reg = 'gloves'
        elif t >= gl0 - 0.035: reg = 'band' if kit in ('line', 'big') else 'wrist'
        elif t >= gl0 - 0.075: reg = 'wrist' if kit in ('line', 'big') else 'skin'
        elif sleeve_end and t < sleeve_end: reg = 'jersey'
        else: reg = 'skin'
    elif p == 'head':
        front = c.y < L['Head'].y - 0.02          # Mixamo characters face -Y in Blender
        if lab == 'blue' and front and c.z > L['Neck'].z + 0.02: reg = 'mask'
        elif lab in ('blue', 'dark', 'navy'): reg = 'facehole' if front and c.z > L['Neck'].z + 0.03 else ('skin' if c.z < L['Head'].z else 'helmet')
        else: reg = {'white': 'helmet', 'skin': 'skin'}[lab]
    else:
        if lab == 'white' and c.z > L['Spine2'].z - 0.05: reg = 'band'
        elif lab == 'skin' and c.z > L['Spine2'].z: reg = 'skin'
        else: reg = 'jersey'
    regions[f.index] = reg

# ---- facemask vs face opening, by geometry
head_front = [f for f in bm.faces if part_of(C(f)) == 'head' and C(f).y < L['Head'].y - 0.02 and C(f).z > L['Neck'].z]
areas = {f.index: f.calc_area() * (M.median_scale ** 2) for f in head_front}
bars = [f for f in head_front if areas[f.index] < 0.0007 and (M.to_3x3() @ f.normal).normalized().y < 0.3]
if bars:
    bz = sorted(C(f).z for f in bars); bx = sorted(abs(C(f).x) for f in bars)
    zlo, zhi = bz[int(len(bz) * 0.03)], bz[int(len(bz) * 0.97)]
    xhi = bx[int(len(bx) * 0.97)]
    yfront = min(C(f).y for f in bars)
    print('cage box z', round(zlo, 3), round(zhi, 3), 'x<', round(xhi, 3))
    for f in head_front:
        c = C(f); a = areas[f.index]
        n = (M.to_3x3() @ f.normal).normalized()
        inside = zlo - 0.01 < c.z < zhi and abs(c.x) < xhi - 0.01
        if inside and a >= 0.0007 and c.y > yfront + 0.012 and n.y < 0.2:
            regions[f.index] = 'facehole'
        elif inside and a < 0.0007 and regions[f.index] in ('mask', 'helmet', 'facehole'):
            regions[f.index] = 'mask'
        elif c.z >= zhi and regions[f.index] in ('mask', 'facehole'):
            regions[f.index] = 'helmet'
        elif not inside and regions[f.index] == 'mask' and a >= 0.0007:
            regions[f.index] = 'helmet'
    # head = pure geometry: bars → mask, recessed forward-facing interior → facehole, rest → helmet (skin kept)
    bar_y = sorted(C(f).y for f in bars)[len(bars) // 2]
    bar_ids = {f.index for f in bars}
    for f in bm.faces:
        c = C(f)
        if part_of(c) != 'head': continue
        r = regions[f.index]
        n = (M.to_3x3() @ f.normal).normalized()
        a_ = f.calc_area() * (M.median_scale ** 2)
        in_box = zlo - 0.01 < c.z < zhi - 0.012 and abs(c.x) < xhi * 0.72
        if f.index in bar_ids and n.z < 0.6 and c.y < bar_y + 0.012: regions[f.index] = 'mask'
        elif in_box and n.y < 0.3 and (c.y > bar_y + 0.004 or a_ >= 0.0007): regions[f.index] = 'facehole'
        elif r == 'skin' and c.z < L['Head'].z + 0.02: regions[f.index] = 'skin'
        else: regions[f.index] = 'helmet'

# majority smoothing for head / collar specks
for _ in range(2):
    out = dict(regions)
    for f in bm.faces:
        if part_of(C(f)) not in ('head', 'torso'): continue
        cnt = {}
        for e in f.edges:
            for g in e.link_faces:
                if g is not f: cnt[regions[g.index]] = cnt.get(regions[g.index], 0) + 1
        if cnt:
            best = max(cnt, key=cnt.get)
            if cnt[best] >= 3 and best != regions[f.index] and regions[f.index] not in ('pants', 'band', 'mask', 'facehole') and best not in ('mask', 'facehole'): out[f.index] = best
    regions = out

# ------------------------------------------------------------ materials + output
me = obj.data; me.materials.clear()
for r in REGIONS:
    m = bpy.data.materials.new(r); m.use_nodes = True
    h = PALETTE[r].lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*lin, 1); bs.inputs['Roughness'].default_value = 1; bs.inputs['Metallic'].default_value = 0
    me.materials.append(m)
for f in bm.faces: f.material_index = RID[regions[f.index]]; f.smooth = False
if dissolve > 0:
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve), use_dissolve_boundaries=False, verts=bm.verts[:], edges=bm.edges[:], delimit={'MATERIAL'})
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
bm.to_mesh(me); bm.free()
while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
for img in list(bpy.data.images): bpy.data.images.remove(img)
cnt = {}
for p in me.polygons: cnt[REGIONS[p.material_index]] = cnt.get(REGIONS[p.material_index], 0) + 1
print('tris', len(me.polygons), cnt)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=False, export_skins=True,
                          export_texcoords=False, export_materials='EXPORT', export_yup=True)
print('wrote', dst)
