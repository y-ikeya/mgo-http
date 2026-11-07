# BB の外壁の外に**観客席**を並べる (2026-11-07 本人「BB のステージの外の背景は観客席っぽくなってる。
# このステージ内を訓練場だと仮定して、それを見るための席なのかな？そんな感じで目隠し作れる？」、MGO2 の
# Blood Bath のスクショ)。外壁の上の金網越しに見える目隠しで、遊びには一切効かない。
#
# 全部 vis_ と noeye の札: 当たりも視線も弾も無い (vis_ だけだと視線を止める物として判定の網 mesh.bin に入り、
# 0.3MB 膨らんだ)。コレクション stands に入れ、
# 流し直すとそのコレクションの中だけを消して作り直す (本人が手で足した物は消さない)。
#
#   開いている Blender で: exec(open('tools/bb_stands.py').read())
#
# --- 形 (1 面ぶん。外壁の外の面から外へ向かって t、高さ z。Blender の座標) ---
#   前の胸壁   t 0.4 から、床 (10m) から 15.6m まで。外壁の上の金網 (14.6m) の上に頭が出る
#   客席       8 段 (奥行き 0.85m、高さ 0.45m)。てっぺんの段は 18.75m、奥は t 7.2m
#              (14 段・建物 28m で作ったら高すぎた。本人「5m 分くらい下げていい、後ろの席を削っていい。高いと囲われてる感が強くなる」)
#   通路の階段 14m おきに幅 1.4m、段の途中に半分の段
#   手すり     胸壁の上と、4 段目の前の縁 (高さ 1.0m、柱 3m おき)
#   建物       客席の奥に、窓 (幅 3m・高さ 2.5m の開口) の並ぶ壁と、奥の塊 (23.5m まで)
#   控え壁     18m おきに、胸壁の下から建物の上まで斜めに渡る厚い壁
#   角の塔     4 つの角は、2 面の客席の端を隠す四角い塔 (25m まで)
# 絵は台座と同じ白っぽい打ちっぱなし (concrete_support_light、無ければ concrete_wall_007)。手すりは金網の枠の
# 鉄 (metal_fence_frame)。新しい色は足さない
import bpy, bmesh, math
from mathutils import Vector

COLLECTION = 'stands'
GAP = 0.4            # 外壁の外の面から胸壁まで
BOTTOM = 10.0        # 足元 (外からは見えない高さ)
PARAPET_TOP = 15.6
TIERS = 8
TIER_D = 0.85
TIER_H = 0.45
BACK_T = GAP + TIERS * TIER_D          # 客席の奥
TOP_ROW = PARAPET_TOP + (TIERS - 1) * TIER_H
BUILDING_D = 4.0
BUILDING_TOP = 23.5
WINDOW_BAND = (TOP_ROW + 1.0, TOP_ROW + 3.5)   # 窓の高さ
TOWER_TOP = 25.0
AISLE_EVERY = 14.0
AISLE_W = 1.4
BUTTRESS_EVERY = 18.0
BUTTRESS_W = 1.6
RAIL_H = 1.0
RAIL_POST_EVERY = 3.0
UV_TILE = 2.16

# 外壁の外の面 (Blender の座標)。along はその面に沿う向き、out は外向き
SIDES = {
    'e': dict(origin=28.39, axis='x', sign=+1, s0=-28.30, s1=28.28),
    'w': dict(origin=-28.41, axis='x', sign=-1, s0=-28.30, s1=28.28),
    'n': dict(origin=28.28, axis='y', sign=+1, s0=-28.41, s1=28.39),
    's': dict(origin=-28.30, axis='y', sign=-1, s0=-28.41, s1=28.39),
}


def material(*names):
    for n in names:
        m = bpy.data.materials.get(n)
        if m:
            return m
    return None


CONCRETE = material('concrete_support_light', 'concrete_wall_007')
METAL = material('metal_fence_frame')


def collection():
    col = bpy.data.collections.get(COLLECTION)
    if col is None:
        col = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(col)
    for o in list(col.objects):
        me = o.data
        bpy.data.objects.remove(o)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    return col


def world(side, s, t, z):
    """面の座標 (s 沿い、t 外向き、z) → Blender の (x, y, z)"""
    d = SIDES[side]
    o = d['origin'] + d['sign'] * t
    return Vector((o, s, z)) if d['axis'] == 'x' else Vector((s, o, z))


def box(bm, side, s0, s1, t0, t1, z0, z1):
    """面の座標で箱を足す"""
    vs = [bm.verts.new(world(side, s, t, z)) for s in (s0, s1) for t in (t0, t1) for z in (z0, z1)]
    i = lambda a, b, c: vs[a * 4 + b * 2 + c]
    for q in ((i(0,0,0), i(0,1,0), i(0,1,1), i(0,0,1)), (i(1,0,0), i(1,0,1), i(1,1,1), i(1,1,0)),
              (i(0,0,0), i(0,0,1), i(1,0,1), i(1,0,0)), (i(0,1,0), i(1,1,0), i(1,1,1), i(0,1,1)),
              (i(0,0,0), i(1,0,0), i(1,1,0), i(0,1,0)), (i(0,0,1), i(0,1,1), i(1,1,1), i(1,0,1))):
        bm.faces.new(q)


def prism(bm, side, s0, s1, profile):
    """(t, z) の輪郭を s0〜s1 に押し出した柱"""
    a = [bm.verts.new(world(side, s0, t, z)) for t, z in profile]
    b = [bm.verts.new(world(side, s1, t, z)) for t, z in profile]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(profile)
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((a[k], a[j], b[j], b[k]))


def finish(col, name, bm, mat, uv=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    if uv:
        layer = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda k: abs(n[k]))
            for l in f.loops:
                p = l.vert.co
                u, v = {0: (p.y, p.z), 1: (p.x, p.z), 2: (p.x, p.y)}[ax]
                l[layer].uv = (u / UV_TILE, v / UV_TILE)
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    return o


def stands(col, side):
    d = SIDES[side]
    s0, s1 = d['s0'], d['s1']
    # 客席: 胸壁の前の面から段々に上がって奥の壁まで、1 本の柱
    prof = [(GAP, BOTTOM), (GAP, PARAPET_TOP)]
    for k in range(TIERS):
        t = GAP + k * TIER_D
        z = PARAPET_TOP + k * TIER_H
        if k > 0:
            prof.append((t, z))
        prof.append((t + TIER_D, z))
        if k < TIERS - 1:
            prof.append((t + TIER_D, z + TIER_H))
    prof.append((BACK_T, BOTTOM))
    bm = bmesh.new()
    prism(bm, side, s0, s1, prof)
    finish(col, f'vis_bb_stands_{side}_noeye', bm, CONCRETE)

    # 通路の階段: 段の途中に半分の段
    bm = bmesh.new()
    n = int((s1 - s0) // AISLE_EVERY)
    centres = [s0 + (s1 - s0) * (k + 0.5) / max(n, 1) for k in range(max(n, 1))]
    for c in centres:
        for k in range(TIERS - 1):
            t = GAP + k * TIER_D
            z = PARAPET_TOP + k * TIER_H
            box(bm, side, c - AISLE_W / 2, c + AISLE_W / 2, t + TIER_D / 2, t + TIER_D, z, z + TIER_H / 2)
    finish(col, f'vis_bb_stands_aisle_{side}_noeye', bm, CONCRETE)

    # 建物: 窓の下の帯・窓の上の帯・窓の間の柱・奥の塊
    bm = bmesh.new()
    lo, hi = WINDOW_BAND
    box(bm, side, s0, s1, BACK_T, BACK_T + 0.5, BOTTOM, lo)
    box(bm, side, s0, s1, BACK_T, BACK_T + 0.5, hi, BUILDING_TOP)
    box(bm, side, s0, s1, BACK_T + 1.5, BACK_T + BUILDING_D, BOTTOM, BUILDING_TOP)
    box(bm, side, s0, s1, BACK_T, BACK_T + 1.5, lo - 0.3, lo)          # 窓の床
    box(bm, side, s0, s1, BACK_T, BACK_T + 1.5, hi, hi + 0.3)          # 窓の天井
    k = 0
    s = s0
    while s < s1 - 0.5:
        box(bm, side, s, min(s + 1.0, s1), BACK_T, BACK_T + 1.5, lo, hi)
        s += 4.0
    box(bm, side, s1 - 1.0, s1, BACK_T, BACK_T + 1.5, lo, hi)
    finish(col, f'vis_bb_stands_building_{side}_noeye', bm, CONCRETE)

    # 控え壁: 胸壁の足元から建物の上へ斜めに
    bm = bmesh.new()
    n = int((s1 - s0) // BUTTRESS_EVERY)
    for k in range(1, n + 1):
        c = s0 + (s1 - s0) * k / (n + 1)
        prism(bm, side, c - BUTTRESS_W / 2, c + BUTTRESS_W / 2,
              [(GAP, BOTTOM), (GAP + 2.0, BOTTOM), (BACK_T + 0.5, BUILDING_TOP + 1.0), (BACK_T - 1.2, BUILDING_TOP + 1.0)])
    finish(col, f'vis_bb_stands_buttress_{side}_noeye', bm, CONCRETE)

    # 手すり: 胸壁の上と、4 段目・8 段目の前の縁。横の管と柱 (細い箱)
    bm = bmesh.new()
    rows = [(GAP + 0.15, PARAPET_TOP)] + [(GAP + k * TIER_D + 0.1, PARAPET_TOP + k * TIER_H) for k in (4,)]
    for t, z in rows:
        box(bm, side, s0, s1, t - 0.03, t + 0.03, z + RAIL_H - 0.06, z + RAIL_H)
        box(bm, side, s0, s1, t - 0.02, t + 0.02, z + RAIL_H / 2 - 0.03, z + RAIL_H / 2 + 0.01)
        s = s0 + 0.5
        while s < s1:
            box(bm, side, s - 0.03, s + 0.03, t - 0.03, t + 0.03, z, z + RAIL_H)
            s += RAIL_POST_EVERY
    finish(col, f'vis_bb_stands_rail_{side}_noeye_notexture', bm, METAL, uv=False)


def towers(col):
    """4 つの角の塔。2 面の客席の端を隠す"""
    depth = BACK_T + BUILDING_D
    corners = {'ne': (28.39, 28.28, +1, +1), 'nw': (-28.41, 28.28, -1, +1),
               'se': (28.39, -28.30, +1, -1), 'sw': (-28.41, -28.30, -1, -1)}
    for name, (x, y, sx, sy) in corners.items():
        bm = bmesh.new()
        xs = sorted((x, x + sx * depth))
        ys = sorted((y, y + sy * depth))
        vs = [bm.verts.new((a, b, c)) for a in xs for b in ys for c in (BOTTOM, TOWER_TOP)]
        i = lambda a, b, c: vs[a * 4 + b * 2 + c]
        for q in ((i(0,0,0), i(0,1,0), i(0,1,1), i(0,0,1)), (i(1,0,0), i(1,0,1), i(1,1,1), i(1,1,0)),
                  (i(0,0,0), i(0,0,1), i(1,0,1), i(1,0,0)), (i(0,1,0), i(1,1,0), i(1,1,1), i(0,1,1)),
                  (i(0,0,0), i(1,0,0), i(1,1,0), i(0,1,0)), (i(0,0,1), i(0,1,1), i(1,1,1), i(1,0,1))):
            bm.faces.new(q)
        finish(col, f'vis_bb_stands_tower_{name}_noeye', bm, CONCRETE)


col = collection()
for side in SIDES:
    stands(col, side)
towers(col)
print('観客席', len(col.objects), '個', sorted(o.name for o in col.objects))
