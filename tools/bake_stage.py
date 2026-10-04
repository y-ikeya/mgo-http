# ステージに「空がどれだけ見えるか」を焼き込む。
#
#   $BLENDER -b tools/raw/stage_mall.blend --python tools/bake_stage.py -- [試行回数]
#
# ステージの元データは tools/stage_*.blend (make_stage.py に名前の決めごと)。
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
import os
import bmesh
import math
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
# 書き出しから読み込まれたときは引数が書き出しの物 (--bake) なので、数字のときだけ採る
SAMPLES = int(argv[0]) if argv and argv[0].isdigit() else 24

# 面を割る間隔 (m)。細かいほど滑らかだが頂点が増える
CELL = 4.0
# ↑ 2.0 にしていた頃、40m の建物 1 棟が 12,000 枚 (glb の形が 8MB) になった。環境光は緩やかにしか変わらないので 4m で足りる
# 小さな物 (これより小さい) の刻み (m)。箱 1 つの面の中にも頂点が入る
PROP_SIZE = 6.0
PROP_CELL = 0.8
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
    # **世界での長さで測る。** obj.scale は自分の分だけで、親の縮尺が乗らない。持ち込みの
    # 置き物 (Sketchfab) は「親 0.01 × 自分 100」の入れ子で来るので、自分の 100 だけを見ると
    # 1cm の辺が 1m に見えて、土嚢 1 個を 6 回割った (97 個で 110 万頂点、glb 28MB)
    # **絶対値で取る。** 鏡像に置いた箱 (拡縮が負) は to_scale が負を返す。負のままだと辺が
    # 「長くない」ことになって割られず (72 棟の箱がそうだった)、格子刻みでは刻み幅が負に
    # なって while が終わらなかった (書き出しが 10 分たっても終わらない)
    scale = max(abs(v) for v in obj.matrix_world.to_scale())
    # 小さな物 (置き物・ブロック) は細かく割る。2m の箱を 4m 刻みだと面の 4 隅だけに値が入り、
    # 四角を 2 つの三角に割った境で明るさの変わり方が折れて、斜めの線に見えた (基地の近くのブロック)
    cell = CELL if max(obj.dimensions) >= PROP_SIZE else PROP_CELL
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for _ in range(6):
        long_edges = [e for e in bm.edges
                      if (e.verts[0].co - e.verts[1].co).length * scale > cell]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=True)
    grid_cut(bm, scale, cell)
    bm.to_mesh(mesh)
    bm.free()


# 格子に刻むメッシュの大きさの上限 (面の数)
GRID_MAX_FACES = 20000


def tangents(n):
    """面に沿った 2 方向。壁なら (水平, 鉛直)、床なら (x, y)"""
    up = Vector((0.0, 0.0, 1.0))
    t1 = up.cross(n)
    if t1.length < 1e-3:
        t1 = Vector((1.0, 0.0, 0.0))
    t1.normalize()
    return t1, n.cross(t1).normalized()


def grid_cut(bm, scale, cell=CELL):
    """広い面を CELL の格子に刻む。辺を割るだけでは足りない面のため。

    窓の口を彫った壁は、口を避けた 1 枚の大きな多角形になる。辺を割っても頂点は縁に
    増えるだけで、面の中には入らない。それを書き出しで三角に割ると壁の端から端へ伸びる
    細長い三角になり、頂点色 (空の見え方) がその上で線形に混ざって、壁を斜めに走る
    明暗の帯に見えた (建物 17 の壁が「下から照らした」ように見えた)。
    面を法線の向きでまとめ、面に沿った 2 方向の平面で CELL ごとに切る。
    """
    # **大きなメッシュには掛けない。** bisect_plane は渡した面が少なくても、印を付け直すのに
    # メッシュ全体を毎回なめる (1 回が要素数に比例)。地面 (十数万面) に何百回も掛けたら
    # 書き出しが 10 分を超えて終わらなかった。大きな物は面も細かく、この帯は出ない
    if len(bm.faces) > GRID_MAX_FACES:
        return
    up = Vector((0.0, 0.0, 1.0))
    groups = {}
    for f in bm.faces:
        # 広さでは選ばない。間引き (export_stage の slim) で n 角形を三角に割った壁は、幅 0.5m ×
        # 長さ 15m の細長い三角になっていて、広さで選ぶと素通りした。広がり (extent) だけで見る
        n = f.normal
        if n.length < 1e-6:
            continue
        # **辺を割って CELL に収まった面は刻まない。** 地面や床は辺を割るだけで格子になる。
        # それまで刻むと 3m の升を 4m 刻みで切って細切れが倍になり、焼く頂点が倍、
        # 書き出しが 10 分を超えた。刻むのは、まだ CELL より広がっている面 (窓を彫った壁) だけ
        t1, t2 = tangents(n)
        cos = [v.co for v in f.verts]
        if all(max(c.dot(t) for c in cos) - min(c.dot(t) for c in cos) < cell * 1.25 / scale for t in (t1, t2)):
            continue
        key = (round(n.x, 2), round(n.y, 2), round(n.z, 2))
        groups.setdefault(key, []).append(f)
    for key, faces in groups.items():
        t1, t2 = tangents(Vector(key).normalized())
        verts = set(v for f in faces for v in f.verts)
        edges = set(e for f in faces for e in f.edges)
        geom = list(verts) + list(edges) + list(faces)
        for t in (t1, t2):
            ts = [v.co.dot(t) for v in verts]
            lo, hi = min(ts), max(ts)
            step = cell / scale
            if step <= 0:
                return
            x = lo + step
            while x < hi - step * 0.25:
                r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=t * x, plane_no=t, dist=1e-5)
                # 戻りの 2 つは重なる (切り口の辺は両方に入る)。同じ物を 2 度渡すと bisect が拒む
                geom = list(set(r['geom']) | set(r['geom_cut']))
                x += step
    # 切った後に残る 5 角以上の面は耳切りで三角にする。書き出しに割らせると裏返る三角が出た
    ngons = [f for f in bm.faces if len(f.verts) > 4]
    if ngons:
        bmesh.ops.triangulate(bm, faces=ngons, quad_method='BEAUTY', ngon_method='EAR_CLIP')


def blocks_nothing(obj):
    """空の光を遮らない物。BVH に入れない。

    壁の汚れ (vis_decal_) は壁から 2cm 浮かせた板で、壁の頂点から飛ばす光線 (EPS = 2cm で
    浮かせて撃つ) がちょうどその板に当たって全部遮られ、壁の真ん中だけ真っ暗になった
    (建物 31 の壁を斜めに走る帯)。ガラス (glass_) は光を通す (実行時も影を落とさない)。
    """
    name = obj.name
    return name.startswith('vis_decal') or name.startswith('glass_') or '_glass' in name


# BVH の三角 → 持ち主の名前 (切り分け用)
tree_owner = []


def build_tree():
    """全メッシュを 1 つの BVH にまとめる。遮蔽はステージ全体で決まる"""
    verts = []
    faces = []
    tree_owner.clear()
    for obj in meshes():
        if blocks_nothing(obj):
            continue
        matrix = obj.matrix_world
        base = len(verts)
        mesh = obj.data
        verts.extend([matrix @ v.co for v in mesh.vertices])
        for poly in mesh.polygons:
            idx = [base + i for i in poly.vertices]
            # 三角に割る。BVHTree は多角形も受けるが、四角より三角のほうが速い
            for k in range(1, len(idx) - 1):
                faces.append((idx[0], idx[k], idx[k + 1]))
                tree_owner.append(obj.name)
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


# これより近くで当たった物は「頂点に食い込んでいる物」として無視する (m)
NEAR_SKIP = 0.3
# 裏から当たった面を「その物の中にいる」と見なす距離 (m)。建物の底は地面より 0.6m 下
BACKFACE_SKIP = 1.0
# 食い込み・裏面を飛ばす回数の上限
SKIP_MAX = 6


def sky_reached(tree, origin, d):
    """光線が空に届くか。**頂点のすぐそばの当たりは飛ばす。**

    窓の口の縁の頂点は木の窓枠の中に埋まっていて、光線が 2cm 先で枠に当たり、24 本とも
    遮られて真っ暗になった。その頂点から壁の升目へ暗さが混ざり、建物 31 の壁に斜めの帯が
    走った (窓の角ごとに暗い楔)。壁に貼った汚れの板や、土嚢のように重なった置き物も同じ。
    近すぎる当たりは食い込みと見て、その先から撃ち直す
    """
    for _ in range(SKIP_MAX):
        loc, face_normal, _, dist = tree.ray_cast(origin, d, REACH)
        if loc is None:
            return True
        # **裏から当たった面は遮らない。** 面の向きと光線が同じ向きなら、その物の中 (地面の下・
        # 窓枠の中) から撃っている。建物の底の頂点は地面より 0.6m 下にあり、上へ飛ばした光線が
        # 地面の裏に当たって全部遮られ、真っ暗な底の頂点が壁の升目へ混ざって足元に楔が出た
        # 遠くの裏面は遮る。片面の板 (屋根) を下から見ると裏面なので、無条件に通すと
        # 部屋の床が屋根を素通りして空を見てしまった (abandonedRoom1 の床だけ真昼の明るさ)
        if dist > NEAR_SKIP and (face_normal.dot(d) <= 0 or dist > BACKFACE_SKIP):
            return False
        origin = loc + d * 0.01
    return False


def bake(samples=SAMPLES):
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
        # **法線は先に全部読む。** 頂点ごとに vertex.normal を引くと、色を 1 つ書くたびに
        # メッシュが「変わった」扱いになって法線を全部計算し直す (頂点数の 2 乗)。
        # 土嚢 97 個を足したら書き出しが終わらなくなった。読んでから書く
        normals = [v.normal.copy() for v in mesh.vertices]
        colors = []
        for i, vertex in enumerate(mesh.vertices):
            world = matrix @ vertex.co
            normal = (normal_matrix @ normals[i]).normalized()
            if normal.length < 1e-6:
                normal = up
            origin = world + normal * EPS
            open_rays = 0
            rays = directions(normal, samples)
            for d in rays:
                if sky_reached(tree, origin, d):
                    # 何にも当たらなければ空。**上を向いた光線ほど価値がある**ので
                    # 天頂への近さで重みを付ける (空は上に広い)
                    open_rays += max(0.0, d.dot(up)) + 0.35
            weight = sum(max(0.0, d.dot(up)) + 0.35 for d in rays)
            sky = open_rays / weight if weight > 0 else 1.0
            value = FLOOR + (1.0 - FLOOR) * sky
            colors.extend((value, value, value, 1.0))
            total += 1
        # まとめて 1 度で書く
        layer.data.foreach_set('color', colors)
        # 切り分け用: BAKE_PROBE=物の名前 で、その物の真っ暗な頂点が何に遮られているかを出す
        if os.environ.get('BAKE_PROBE') == obj.name:
            dark = [i for i in range(len(mesh.vertices)) if colors[i * 4] <= FLOOR + 0.01]
            print(f'[bake] {obj.name}: 頂点 {len(mesh.vertices)} のうち真っ暗 {len(dark)}', flush=True)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            probe_bm = bmesh.new()
            probe_bm.from_mesh(mesh)
            probe_bm.normal_update()
            probe_bm.verts.ensure_lookup_table()
            print(f'[bake]   面 {len(probe_bm.faces)} 辺 {len(probe_bm.edges)} 頂点 {len(probe_bm.verts)}', flush=True)
            for i in dark[:4]:
                v = probe_bm.verts[i]
                print(f'[bake]   頂点 {i} {tuple(round(c, 2) for c in v.co)} 隣の面 {len(v.link_faces)}: ' + ' '.join(f'{tuple(round(c, 2) for c in f.normal)}x{len(f.verts)}' for f in v.link_faces[:6]), flush=True)
            probe_bm.free()
            # 外壁の頂点 (法線が南向き) を優先して、24 本の光線が何に当たるかを数える
            axis = Vector(tuple(float(x) for x in os.environ.get('BAKE_PROBE_NORMAL', '0,-1,0').split(',')))
            outer = [i for i in dark if (normal_matrix @ normals[i]).normalized().dot(axis) > 0.9]
            print(f'[bake]   うち法線 {tuple(axis)} 向き {len(outer)}', flush=True)
            for i in (outer or dark)[:6]:
                world = matrix @ mesh.vertices[i].co
                normal = (normal_matrix @ normals[i]).normalized()
                counts = {}
                for d in directions(normal, samples):
                    loc, _, idx, _ = tree.ray_cast(world + normal * EPS, d, REACH)
                    key = '空' if loc is None else f'{tree_owner[idx]}@{round((loc - world).length, 2)}m'
                    counts[key] = counts.get(key, 0) + 1
                print(f'[bake]   {tuple(round(v, 2) for v in world)} n={tuple(round(v, 2) for v in normal)} → {sorted(counts.items(), key=lambda kv: -kv[1])[:5]}', flush=True)
    return total


def run(samples=SAMPLES, save=True):
    """割って焼く。save=False なら .blend に書かない (書き出しの中で使う: export_stage.py -- --bake)"""
    import time
    for obj in meshes():
        if shared(obj):
            continue
        t0 = time.time()
        if os.environ.get('BAKE_TRACE'):
            print(f'[bake] 割る: {obj.name} ({len(obj.data.polygons)} 面)', flush=True)
        subdivide(obj)
        if time.time() - t0 > 2.0:
            print(f'[bake] {obj.name}: 割るのに {time.time() - t0:.0f} 秒 ({len(obj.data.polygons)} 面)', flush=True)
    print(f'[bake] 割った。頂点 {sum(len(o.data.vertices) for o in meshes())} 個')
    count = bake(samples)
    print(f'[bake] 焼いた。{count} 頂点 / 試行 {samples} 本')
    if save:
        bpy.ops.wm.save_mainfile()
        print('[bake] 保存した。次: export_stage.py で書き出す')


if __name__ == '__main__':
    run(SAMPLES, save=True)
