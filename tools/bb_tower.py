# BB の真ん中の塔 (本人の画面 2026-11-05「真ん中の塔の柵はボロボロ、上に行けても狙われやすい」
# 「塔の 2F 部分は四角じゃなくて筒」)。
#
#   筒      concrete_tower         2F より上は円柱 (32 角、外側は 1 枚につながった網で丸く見せる)、ベランダから 2.8m の低いトーチカ。1 面おきに覗き穴
#                                  (中には入れない)。1F の土台 (concrete_tower_base) は四角のまま
#   崩れた壁 concrete_tower_parapet_<辺>   ベランダの外の縁に、高さ 0.4〜1.2m のまばらな塊。切れ目がある
#                                          (人も弾も止めるが、隠れきれない)。跳び移る所は空ける
#
# make_bb.py からも、開いている blend からも呼ぶ
import bmesh
import math
import random

SIDES = 32
PARAPET_T = 0.3
CHUNK = (0.6, 1.8)        # 塊の長さ
GAP = (0.2, 1.0)          # 切れ目の長さ
HEIGHT = (0.4, 1.2)       # 塊の高さ (ベランダの床から)


def _new(bpy, scene, name, build):
    old = bpy.data.objects.get(name)
    if old:
        me = old.data
        bpy.data.objects.remove(old)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    # 面の向きを外へ揃える (組む時の頂点の順がばらばらで、書き出しが 300 枚あまり裏返していた)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


WALL = 0.5                # 筒の壁の厚み。覗き穴はこの深さだけ凹む (奥は芯で塞がっている、中には入れない)
SLIT_W, SLIT_Z, SLIT_H = 0.9, 1.2, 0.25   # 覗き穴の幅・下端 (ベランダの床から)・高さ。1 面おき


SLITS = 8                 # 覗き穴の数 (周りに等間隔)


def tube(bpy, scene, cx, cy, r, z0, z1, name='concrete_tower', floor=None):
    """筒。**外側の面は 1 枚につながった網** — 面ごとに別の箱で組んでいたら頂点が共有されず、Shade Auto Smooth
    しても角が立った (2026-11-05 本人「全然滑らかにならない」)。floor (ベランダの床) を渡すと、そこから SLIT_Z の
    高さに覗き穴 (本人「周囲を見渡せるトーチカ、覗き穴がある、中には入れない」)。穴は壁の厚み WALL だけ凹む"""
    def build(bm):
        half = (SLIT_W / 2) / r                     # 覗き穴の半分の角度
        slits = [2 * math.pi * (k + 0.5) / SLITS for k in range(SLITS)] if floor is not None else []
        angles = sorted({2 * math.pi * i / SIDES for i in range(SIDES)} |
                        {a % (2 * math.pi) for c in slits for a in (c - half, c + half)})
        zs = [z0, z1] if floor is None else [z0, floor + SLIT_Z, floor + SLIT_Z + SLIT_H, z1]
        n = len(angles)
        grid = [[bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)) for z in zs] for a in angles]

        def in_slit(a):
            return any(abs((a - c + math.pi) % (2 * math.pi) - math.pi) < half - 1e-6 for c in slits)

        for i in range(n):
            j = (i + 1) % n
            a0, a1 = angles[i], angles[j] if j else angles[j] + 2 * math.pi
            mid = (a0 + a1) / 2
            for k in range(len(zs) - 1):
                if floor is not None and k == 1 and in_slit(mid):
                    # 穴: 奥 (半径 r - WALL) と上下・左右の面
                    rin = r - WALL
                    bl = bm.verts.new((cx + rin * math.cos(a0), cy + rin * math.sin(a0), zs[1]))
                    br = bm.verts.new((cx + rin * math.cos(a1), cy + rin * math.sin(a1), zs[1]))
                    tl = bm.verts.new((cx + rin * math.cos(a0), cy + rin * math.sin(a0), zs[2]))
                    tr = bm.verts.new((cx + rin * math.cos(a1), cy + rin * math.sin(a1), zs[2]))
                    bm.faces.new((bl, br, tr, tl))                                   # 奥
                    bm.faces.new((grid[i][1], grid[j][1], br, bl))                   # 下
                    bm.faces.new((tl, tr, grid[j][2], grid[i][2]))                   # 上
                    if not in_slit(a0 - 1e-4):
                        bm.faces.new((grid[i][1], bl, tl, grid[i][2]))               # 左の縁
                    if not in_slit(a1 + 1e-4):
                        bm.faces.new((br, grid[j][1], grid[j][2], tr))               # 右の縁
                    continue
                bm.faces.new((grid[i][k], grid[j][k], grid[j][k + 1], grid[i][k + 1]))
        bm.faces.new([grid[i][-1] for i in range(n)])                                 # 屋根
        bm.faces.new([grid[i][0] for i in reversed(range(n))])                       # 底
        # 穴が 2 つの区間にまたがる時、奥どうしの境目に頂点が重なる。つなげる
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    o = _new(bpy, scene, name, build)
    # 丸く見せる。角度の大きい所 (穴の縁・屋根の縁) は角のまま
    for p in o.data.polygons:
        p.use_smooth = True
    try:
        mod = o.modifiers.new('smooth', 'NODES')
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.modifiers.remove(mod)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
    except Exception as error:   # 画面の無い Blender などで演算子が使えない時は、滑らかの印だけ
        print('shade_smooth_by_angle が使えない:', error)
    return o


def parapet(bpy, scene, x0, y0, x1, y1, z, gaps, seed=5):
    """ベランダの外の縁 (矩形 x0..x1 × y0..y1、床の上面 z) に崩れた壁。gaps: {辺: (始まり, 終わり)} は空ける (x か y の範囲)"""
    rng = random.Random(seed)
    edges = {
        'n': ((x0, y1), (x1, y1), (0, -1)),
        's': ((x0, y0), (x1, y0), (0, 1)),
        'w': ((x0, y0), (x0, y1), (1, 0)),
        'e': ((x1, y0), (x1, y1), (-1, 0)),
    }
    made = []
    for side, ((ax, ay), (bx, by), (nx, ny)) in edges.items():
        along_x = ay == by
        start, end = (ax, bx) if along_x else (ay, by)
        hole = gaps.get(side)

        def build(bm):
            u = start
            while u < end:
                length = rng.uniform(*CHUNK)
                v = min(end, u + length)
                if hole and v > hole[0] and u < hole[1]:
                    # 跳び移る所に掛かる塊は、手前で切る
                    if u < hole[0]:
                        v = hole[0]
                    else:
                        u = hole[1]
                        continue
                h = rng.uniform(*HEIGHT)
                # 壁は縁から内へ PARAPET_T
                if along_x:
                    lo = (u, ay + (0 if ny > 0 else -PARAPET_T), z)
                    hi = (v, ay + (PARAPET_T if ny > 0 else 0), z + h)
                else:
                    lo = (ax + (0 if nx > 0 else -PARAPET_T), u, z)
                    hi = (ax + (PARAPET_T if nx > 0 else 0), v, z + h)
                g = bmesh.ops.create_cube(bm, size=1.0)['verts']
                for vert in g:
                    vert.co.x = lo[0] if vert.co.x < 0 else hi[0]
                    vert.co.y = lo[1] if vert.co.y < 0 else hi[1]
                    vert.co.z = lo[2] if vert.co.z < 0 else hi[2]
                    # 上の面を少し傾けて、欠けた形に
                    if vert.co.z > z + 0.01:
                        vert.co.z += rng.uniform(-0.15, 0.15)
                u = v + rng.uniform(*GAP)
        made.append(_new(bpy, scene, f'concrete_tower_parapet_{side}', build))
    return made
