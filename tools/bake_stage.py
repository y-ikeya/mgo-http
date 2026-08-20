# ステージに「空がどれだけ見えるか」を焼き込む。
#
#   $BLENDER -b tools/garage.blend --python tools/bake_stage.py -- [試行回数]
#
# --- なぜ要るか ---
# 実行時の環境光 (HemisphereLight) は**どこでも同じ明るさ**で当たる。だから
# 建物の奥も外の縁も同じ明るさになり、床一面が平らな灰色に見える。実際には
# 光は開口から入って奥ほど届かないので、**縁の近くだけ明るい**のが自然な見え方。
#
# 直射 (DirectionalLight) は実行時に影まで含めて計算しているので、ここで焼くのは
# **空からの光がどれだけ届くか**だけ。上半球へ光線を飛ばして、遮られなかった
# 割合を頂点色に入れる。実行時はそれを色に掛ける。
#
# --- なぜ Cycles を使わないか ---
# 形が軸に沿った箱ばかりなので、光線を自分で飛ばすほうが速くて読める。Cycles だと
# 材質と世界の設定を実行時と合わせる作業が要り、合っているかも確かめにくい。
# 跳ね返りは計算しない — **1 回で空に届くか**だけ見る。
#
# 頂点で持つので、面は細かく割ってから焼く。割らないと箱の 8 隅にしか値が無く、
# 床一面が 4 点の平均になる。

import bpy
import bmesh
import math
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAMPLES = int(argv[0]) if argv else 24

# 面を割る間隔 (m)。細かいほど滑らかだが頂点が増える
CELL = 2.0
# 一番暗い所の明るさ。0 にすると奥が真っ黒になる — 実際は跳ね返りで少しは明るい
FLOOR = 0.3
# 光線を飛ばす距離 (m)。ステージの対角より長ければ十分
REACH = 120.0
# 面から浮かせて撃つ量 (m)。自分自身に当たるのを避ける
EPS = 0.02
# 頂点色の名前。glTF では COLOR_0 として出る
LAYER = 'sky'
# 色の持ち方。**1 成分 1 バイト**で足りる (明るさの階調が 256 段あれば十分)。
# FLOAT_COLOR だと 1 頂点 16 バイト、BYTE_COLOR なら 4 バイト
COLOR_TYPE = 'BYTE_COLOR'


def meshes():
    return [o for o in bpy.context.scene.objects
            if o.type == 'MESH' and not o.name.startswith('ref_')]


def shared(obj):
    """他と同じメッシュを使い回しているか。**焼く対象から外す。**

    車は 1 つのメッシュを 10 台で使い回している。共有したまま焼くと最後の 1 台の
    値が全部に出るし、台ごとに複製すると**頂点が 10 倍**になって glb がそのまま
    膨らむ (実測 5.4MB → 14.2MB、増えた分はほぼ車)。

    置き場所ごとの明るさが乗らないぶん、車だけは環境光そのままで浮く。それでも
    **地形の明暗が付く効果のほうが大きい**ので、ここは共有を優先する。
    """
    return obj.data.users > 1


def subdivide(obj):
    """辺が CELL より長い面を割る。頂点で光を持つので、粗いと階段になる。

    半分に割るのを繰り返す。**一度に必要な数だけ割ろうとすると壊れる** —
    bmesh は 1 回の呼び出しで 1 つの本数しか取れず、割った時点で他の辺の参照が
    無効になるので、まとめて渡した分が静かに落ちる (実際、床が 1 枚も割れて
    いなかった)。

    半分ずつなので CELL ちょうどにはならない。48m の辺なら 24 → 12 → 6 → 3 で
    止まる (CELL 4.0 のとき)。**粗いぶんには構わない** — 環境光は緩やかにしか
    変わらないので、3m 間隔でも段には見えない。
    """
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for _ in range(6):
        long_edges = [e for e in bm.edges
                      if (e.verts[0].co - e.verts[1].co).length * max(obj.scale) > CELL]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=True)
    bm.to_mesh(mesh)
    bm.free()


def build_tree():
    """全メッシュを 1 つの BVH にまとめる。遮蔽はステージ全体で決まる"""
    verts = []
    faces = []
    for obj in meshes():
        matrix = obj.matrix_world
        base = len(verts)
        mesh = obj.data
        verts.extend([matrix @ v.co for v in mesh.vertices])
        for poly in mesh.polygons:
            idx = [base + i for i in poly.vertices]
            # 三角に割る。BVHTree は多角形も受けるが、四角より三角のほうが速い
            for k in range(1, len(idx) - 1):
                faces.append((idx[0], idx[k], idx[k + 1]))
    return BVHTree.FromPolygons(verts, faces, all_triangles=True, epsilon=0.0)


def directions(normal, count):
    """法線の半球にばらまく向き。**上を厚めに見る** (空は上にあるので)"""
    out = []
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(count):
        # フィボナッチ球の上半分。偏りが少なく、少ない本数でも均される
        z = 1.0 - (i + 0.5) / count
        r = math.sqrt(max(0.0, 1.0 - z * z))
        theta = golden * i
        d = Vector((math.cos(theta) * r, math.sin(theta) * r, z))
        # 法線側へ倒す。裏へ向いた分は法線で反射させて使う
        if d.dot(normal) < 0:
            d = d - 2 * d.dot(normal) * normal
        out.append(d.normalized())
    return out


def flat(mesh, value=1.0):
    """焼かないメッシュにも色の欄を作る。**全部の面が同じ形で無いと困る**

    片方だけ色を持っていると、実行時に材質を分けることになる。中身は
    そのまま (1.0 = 環境光をそのまま受ける)。
    """
    if LAYER in mesh.color_attributes:
        return
    layer = mesh.color_attributes.new(name=LAYER, type=COLOR_TYPE, domain='POINT')
    for entry in layer.data:
        entry.color = (value, value, value, 1.0)


def bake():
    tree = build_tree()
    up = Vector((0.0, 0.0, 1.0))
    total = 0
    for obj in meshes():
        mesh = obj.data
        if shared(obj):
            flat(mesh)
            continue
        if LAYER in mesh.color_attributes:
            mesh.color_attributes.remove(mesh.color_attributes[LAYER])
        layer = mesh.color_attributes.new(name=LAYER, type=COLOR_TYPE, domain='POINT')
        matrix = obj.matrix_world
        normal_matrix = matrix.inverted_safe().transposed().to_3x3()
        for i, vertex in enumerate(mesh.vertices):
            world = matrix @ vertex.co
            normal = (normal_matrix @ vertex.normal).normalized()
            if normal.length < 1e-6:
                normal = up
            origin = world + normal * EPS
            open_rays = 0
            rays = directions(normal, SAMPLES)
            for d in rays:
                hit = tree.ray_cast(origin, d, REACH)
                # 何にも当たらなければ空。**上を向いた光線ほど価値がある**ので
                # 天頂への近さで重みを付ける (空は上に広い)
                if hit[0] is None:
                    open_rays += max(0.0, d.dot(up)) + 0.35
            weight = sum(max(0.0, d.dot(up)) + 0.35 for d in rays)
            sky = open_rays / weight if weight > 0 else 1.0
            value = FLOOR + (1.0 - FLOOR) * sky
            layer.data[i].color = (value, value, value, 1.0)
            total += 1
    return total


for obj in meshes():
    if shared(obj):
        continue
    subdivide(obj)
print(f'[bake] 割った。頂点 {sum(len(o.data.vertices) for o in meshes())} 個')
count = bake()
print(f'[bake] 焼いた。{count} 頂点 / 試行 {SAMPLES} 本')

bpy.ops.wm.save_mainfile()
print('[bake] 保存した。次: export_stage.py で書き出す')
