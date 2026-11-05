# BB の真ん中の塔 (本人の画面 2026-11-05「真ん中の塔の柵はボロボロ、上に行けても狙われやすい」
# 「塔の 2F 部分は四角じゃなくて筒」)。
#
#   筒      concrete_tower         2F より上は円柱 (16 角)、ベランダから 2.8m の低いトーチカ。1 面おきに覗き穴
#                                  (中には入れない)。1F の土台 (concrete_tower_base) は四角のまま
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
    # 面の向きを外へ揃える (組む時の頂点の順がばらばらで、書き出しが 300 枚あまり裏返していた)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


WALL = 0.5                # 筒の壁の厚み。覗き穴はこの深さだけ凹む (奥は芯で塞がっている、中には入れない)
SLIT_W, SLIT_Z, SLIT_H = 0.9, 1.2, 0.25   # 覗き穴の幅・下端 (ベランダの床から)・高さ。1 面おき


def tube(bpy, scene, cx, cy, r, z0, z1, name='concrete_tower', floor=None):
    """筒。floor (ベランダの床の高さ) を渡すと、そこから SLIT_Z の高さに 1 面おきに覗き穴 (本人「周囲を
    見渡せるトーチカ、覗き穴がある、中には入れない」)"""
    def ring(rad, a):
        return cx + rad * math.cos(a), cy + rad * math.sin(a)

    def prism(bm, a0, a1, r0, r1, h0, h1):
        """角度 a0..a1、半径 r0..r1、高さ h0..h1 の塊 (辺は直線)"""
        pts = [ring(r0, a0), ring(r0, a1), ring(r1, a1), ring(r1, a0)]
        lo = [bm.verts.new((x, y, h0)) for x, y in pts]
        hi = [bm.verts.new((x, y, h1)) for x, y in pts]
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))

    def build(bm):
        rin = r - WALL
        # 芯 (中には入れない)
        core = [bm.verts.new((*ring(rin, 2 * math.pi * i / SIDES), z0)) for i in range(SIDES)]
        top = [bm.verts.new((v.co.x, v.co.y, z1)) for v in core]
        bm.faces.new(list(reversed(core)))
        bm.faces.new(top)
        for i in range(SIDES):
            j = (i + 1) % SIDES
            bm.faces.new((core[i], core[j], top[j], top[i]))
        # 壁 (面ごと)。覗き穴のある面は、穴の上下左右に分ける
        for i in range(SIDES):
            a0, a1 = 2 * math.pi * i / SIDES, 2 * math.pi * (i + 1) / SIDES
            if floor is None or i % 2:
                prism(bm, a0, a1, rin, r, z0, z1)
                continue
            s0, s1 = floor + SLIT_Z, floor + SLIT_Z + SLIT_H
            side = 2 * r * math.sin(math.pi / SIDES)
            f = min(0.45, SLIT_W / side / 2)
            am0, am1 = (a0 + a1) / 2 - (a1 - a0) * f, (a0 + a1) / 2 + (a1 - a0) * f
            prism(bm, a0, a1, rin, r, z0, s0)
            prism(bm, a0, a1, rin, r, s1, z1)
            prism(bm, a0, am0, rin, r, s0, s1)
            prism(bm, am1, a1, rin, r, s0, s1)
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
