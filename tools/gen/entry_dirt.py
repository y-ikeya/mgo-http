# 建物の入り口の前の地面を汚す。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/entry_dirt.py').read(), {'ENTRY_DIRT': {'body': 'concrete_building3', 'tag': '3'}})
#
# --- なぜ ---
# **入り口の前こそ踏まれて汚れている。** それが遊ぶ人にとって「ここから入れる」の印に
# なる (本人 2026-10-17)。地面の汚れ (vis_decal_ground_dirt_nouv) は道の縁に沿った帯で、
# 入り口とは関係なく置かれていた。
#
# --- 入り口の見つけ方 ---
# 建物の外接の四辺から内へ水平に線を引く。同じ位置で 2 階の壁の高さ (UPPER_Z) と、扉の高さの
# 真ん中 (DOOR_Z)・足元 (FOOT_Z) を比べ、**両方とも 2 階の壁より奥まで入れた**所が入り口
# (窓は足元で止まる)。続いている所をまとめて 1 つの口にする。外周を一筆で取らないのは、
# 壁を別々に組んだ本体 (b3) だと取れないため。
#
# --- 汚し方 ---
# 外から敷居を通って中へ続く**踏み跡の道**を敷く (本人 2026-10-17「道みたいに建物内に
# 繋がってるように」)。真ん中の線が濃く、左右と両端で薄い。材質は入り口だけの黒っぽい泥
# (decal_entry_dirt、絵は tools/raw/decals/decal_entry_dirt.png)。
import bpy, bmesh, math
from mathutils import Vector

UPPER_Z = 14.2     # 2 階の壁の高さ。口の上にある壁の位置をここで測る
DOOR_Z = 11.0      # 扉の高さの真ん中
FOOT_Z = 10.25     # 足元 (窓の口はここで止まる)
STEP = 0.2         # 壁の線に沿って調べる間隔
PROBE_OUT = 0.3    # 外接の箱のどれだけ外から線を引くか (隣の建物が近い路地があるので浅く)
MIN_WIDTH = 0.7    # これより狭い口は入り口と見ない
MERGE_GAP_OPEN = 3.0  # 間が 1 階の壁より奥まっていれば、ここまで離れていても 1 つの口
PATH_OUT = 3.5     # 道を外へ延ばす長さ (口の幅の半分に足す)
PATH_IN = 2.5      # 道を中へ延ばす長さ
PATH_HALF = 1.0    # 道の半幅の上限 (口の真ん中を通る踏み跡)
LIFT = 0.012       # 地面から浮かせる量


def _ray(scene, dg, origin, direction, limit=200.0):
    """汚れの板 (vis_) を素通りして、最初に当たる物"""
    o = origin.copy()
    travelled = 0.0
    for _ in range(12):
        r = scene.ray_cast(dg, o, direction, distance=limit - travelled)
        if not r[0] or not r[4].name.startswith('vis_'):
            if r[0]:
                return True, r[1], r[4]
            return False, None, None
        step = (r[1] - o).length + 0.002
        travelled += step
        o = o + direction * step
    return False, None, None


def find_entries(body):
    """建物の外接の四辺から内へ水平に線を引いて、1 階の口を探す。

    本体が壁を別々に組んだ形 (b3) だと外周が一筆で取れないので、外周は使わない。
    同じ位置で 2 階の壁 (UPPER_Z) と扉の高さ・足元を比べ、**2 階の壁より奥まで
    入れた**所を口とする (1 階が吹き放しの角もここで拾える)
    """
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    bb = [body.matrix_world @ Vector(c) for c in body.bound_box]
    lo = Vector([min(p[i] for p in bb) for i in range(3)])
    hi = Vector([max(p[i] for p in bb) for i in range(3)])
    sides = (
        (Vector((1, 0, 0)), lambda s: Vector((lo.x - PROBE_OUT, s, 0)), lo.y, hi.y),
        (Vector((-1, 0, 0)), lambda s: Vector((hi.x + PROBE_OUT, s, 0)), lo.y, hi.y),
        (Vector((0, 1, 0)), lambda s: Vector((s, lo.y - PROBE_OUT, 0)), lo.x, hi.x),
        (Vector((0, -1, 0)), lambda s: Vector((s, hi.y + PROBE_OUT, 0)), lo.x, hi.x),
    )
    entries = []
    for inward, start, a, b in sides:
        samples = []
        s = a + STEP / 2
        while s < b:
            o = start(s)
            wall = _ray(scene, dg, Vector((o.x, o.y, UPPER_Z)), inward)
            if not wall[0] or wall[2] != body:
                samples.append((s, None)); s += STEP; continue
            d0 = (Vector((wall[1].x, wall[1].y, 0)) - o).length
            deep = True
            dz = 99
            for z in (DOOR_Z, FOOT_Z):
                r = _ray(scene, dg, Vector((o.x, o.y, z)), inward)
                d = (Vector((r[1].x, r[1].y, 0)) - o).length if r[0] else 99
                if z == DOOR_Z:
                    dz = d
                # 口に閉まったシャッターがあれば口ではない (奥まっていても通れない)。
                # 部屋の奥の壁のシャッター (b3 の東は 17m 奥) は関係ない
                if r[0] and 'shutter' in r[2].name.lower() and d < d0 + 1.0:
                    deep = False
                    dz = d0
                    break
                if d < d0 + 0.6:
                    deep = False
            samples.append((s, (d0, deep, dz)))
            s += STEP
        # 1 階の壁の線 (扉の高さで、口でない所の奥行きの真ん中の値)。2 階が張り出していると
        # 1 階の壁は 2 階の壁より奥にある
        walls = sorted(v[2] for _, v in samples if v is not None and not v[1])
        floor_wall = walls[len(walls) // 2] if walls else 0
        runs = []
        run = None
        for s, val in samples + [(b, None)]:
            deep = val is not None and val[1]
            if deep and run is None:
                run = [s, s, val[0]]
            elif deep:
                run[1] = s
            elif run:
                runs.append(run); run = None
        # **柱で割れた 1 つの口をまとめる。** 間の扉の高さが 1 階の壁より奥まっていれば
        # (柱が口より奥にある) 1 つの口。b3 の東は割れたまま道が両端にしか付かなかった。
        # 壁で隔たった扉 (b3 の北) はまとめない
        joined = []
        for r in runs:
            if joined:
                prev = joined[-1]
                between = [v for t_, v in samples if v is not None and prev[1] < t_ < r[0]]
                if r[0] - prev[1] <= MERGE_GAP_OPEN and between and all(v[2] > floor_wall + 0.3 for v in between):
                    prev[1] = r[1]
                    continue
            joined.append(list(r))
        for r in joined:
            width = r[1] - r[0] + STEP
            if width >= MIN_WIDTH:
                mid = start((r[0] + r[1]) / 2) + inward * r[2]
                t = Vector((-inward.y, inward.x, 0))
                entries.append({'at': Vector((mid.x, mid.y, 0)), 'normal': -inward, 'along': t, 'width': width})
    return entries


def _ground(scene, dg, p):
    r = _ray(scene, dg, Vector((p.x, p.y, FOOT_Z + 0.4)), Vector((0, 0, -1)))
    return r[1].z if r[0] else 10.0


def entry_dirt(body_name, tag):
    """口ごとに、外から敷居を通って中へ続く踏み跡の道を敷く。

    真ん中の線が一番濃く (絵の v = 1)、左右の縁で薄い (v = 0)。外の端と中の端は
    細くすぼめて消す。材質は入り口だけの黒っぽい泥 (decal_entry_dirt) —
    地面の汚れ (decal_dirt) は土の床と同じ焦茶で、地面を暗くしたら溶けて見えなくなった
    """
    body = bpy.data.objects[body_name]
    entries = find_entries(body)
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    # 前に作った物を消す (入り口ごとの物 _1, _2 … と、まとめて 1 つだった頃の物)
    prefix = f'vis_decal_b{tag}_entry_dirt'
    for o in [o for o in bpy.data.objects if o.name.startswith(prefix)]:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    made = []
    for index, e in enumerate(entries):
        bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
        center, n, t = e['at'], e['normal'], e['along']
        # 道の幅は口の幅ではなく人が通る幅。広い口 (b3 の北は 9.4m) でも真ん中に 1 本
        half = min(e['width'] / 2, PATH_HALF)
        # 道の断面: (外への距離, 半幅)。外の端と中の端はすぼめる
        out_len = PATH_OUT + half
        # (外への距離, 半幅, 真ん中の濃さ)。両端は細く・薄くして、切れ目を見せない
        stations = [
            (-PATH_IN, 0.3, 0.0),
            (-PATH_IN * 0.6, half * 0.8, 0.7),
            (0.0, half + 0.2, 1.0),
            (out_len * 0.35, half + 0.45, 1.0),
            (out_len * 0.7, half + 0.35, 0.75),
            (out_len, 0.4, 0.0),
        ]
        rows = []
        for d, w, strength in stations:
            row = []
            for side in (-1, 0, 1):
                p = center + n * d + t * (w * side)
                row.append(bm.verts.new(Vector((p.x, p.y, _ground(scene, dg, p) + LIFT))))
            rows.append((d, row, strength))
        for (d0, r0, s0), (d1, r1, s1) in zip(rows, rows[1:]):
            u0, u1 = d0 / 2.3, d1 / 2.3
            for k in range(2):
                a0, a1 = r0[k], r0[k + 1]
                b0, b1 = r1[k], r1[k + 1]
                f = bm.faces.new((a0, a1, b1, b0))
                # 真ん中の頂点が濃い (k=0 なら a1/b1、k=1 なら a0/b0)。縁は 0
                if k == 0:
                    vals = ((u0, 0.0), (u0, s0), (u1, s1), (u1, 0.0))
                else:
                    vals = ((u0, s0), (u0, 0.0), (u1, 0.0), (u1, s1))
                for loop, val in zip(f.loops, vals):
                    loop[uv].uv = val
        bm.normal_update()
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
        # **入り口ごとに 1 つの物、中心点はその道の真ん中。** 動かす・回す・縮めるを入り口ごとに
        # 手でできるように (本人 2026-10-17「中心点が離れたところにあると scale しにくい」)
        mid = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
        bmesh.ops.translate(bm, vec=-mid, verts=bm.verts)
        name = f'{prefix}_{index + 1}_nouv'
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(name, me)
        o.location = mid
        scene.collection.objects.link(o)
        me.materials.append(bpy.data.materials['decal_entry_dirt'])
        made.append(name)
    return [(round(e['at'].x, 2), round(e['at'].y, 2), round(e['width'], 2)) for e in entries]


if globals().get('ENTRY_DIRT'):
    _c = ENTRY_DIRT
    print(entry_dirt(_c['body'], _c['tag']))
