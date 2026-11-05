# BB の真ん中の塔 (本人の画面 2026-11-05「真ん中の塔の柵はボロボロ、上に行けても狙われやすい」
# 「塔の 2F 部分は四角じゃなくて筒」)。
#
#   筒      concrete_tower         2F より上は円柱 (16 角)。1F の土台 (concrete_tower_base) は四角のまま
#   崩れた壁 concrete_tower_parapet_<辺>   ベランダの外の縁に、高さ 0.4〜1.2m のまばらな塊。切れ目がある
#                                          (人も弾も止めるが、隠れきれない)。跳び移る所は空ける
#
# make_bb.py からも、開いている blend からも呼ぶ
import bmesh
import math
import random

SIDES = 16
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
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def tube(bpy, scene, cx, cy, r, z0, z1, name='concrete_tower'):
    def build(bm):
        lo = [bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z0)) for a in (2 * math.pi * i / SIDES for i in range(SIDES))]
        hi = [bm.verts.new((v.co.x, v.co.y, z1)) for v in lo]
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        for i in range(SIDES):
            j = (i + 1) % SIDES
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    return _new(bpy, scene, name, build)


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
