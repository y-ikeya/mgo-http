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
# 口の真ん中 (敷居) から外へ半円の扇を広げる。敷居が一番濃く (絵の v = 1)、縁へ向けて
# 薄くなる (v = 0)。中へも小さく扇を入れる — 踏み跡は中へ続いている。
import bpy, bmesh, math
from mathutils import Vector

UPPER_Z = 14.2     # 2 階の壁の高さ。口の上にある壁の位置をここで測る
DOOR_Z = 11.0      # 扉の高さの真ん中
FOOT_Z = 10.25     # 足元 (窓の口はここで止まる)
STEP = 0.2         # 壁の線に沿って調べる間隔
PROBE_OUT = 0.3    # 外接の箱のどれだけ外から線を引くか (隣の建物が近い路地があるので浅く)
MIN_WIDTH = 0.7    # これより狭い口は入り口と見ない
MERGE_GAP = 0.5    # 柱で割れた口をまとめる間 (m)。広げすぎると壁で隔たった扉 (b3 の北) まで 1 つになる。割れたままでも扇が重なって 1 つの汚れに見える
OUT_RADIUS = 2.6   # 外へ広げる半径 (口の幅の半分に足す)
IN_RADIUS = 1.2    # 中へ入れる半径
SEGMENTS = 12
LIFT = 0.012       # 地面から浮かせる量


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
            wall = scene.ray_cast(dg, Vector((o.x, o.y, UPPER_Z)), inward)
            if not wall[0] or wall[4] != body:
                samples.append((s, None)); s += STEP; continue
            d0 = (Vector((wall[1].x, wall[1].y, 0)) - o).length
            deep = True
            for z in (DOOR_Z, FOOT_Z):
                r = scene.ray_cast(dg, Vector((o.x, o.y, z)), inward)
                d = (Vector((r[1].x, r[1].y, 0)) - o).length if r[0] else 99
                # 閉まったシャッターは口ではない (奥まっていても通れない)
                if r[0] and 'shutter' in r[4].name.lower():
                    deep = False
                    break
                if d < d0 + 0.6:
                    deep = False
                    break
            samples.append((s, (d0, deep)))
            s += STEP
        run = None
        for s, val in samples + [(b, None)]:
            deep = val is not None and val[1]
            if deep and run is None:
                run = [s, s, val[0]]
            elif deep:
                run[1] = s
            elif run:
                width = run[1] - run[0] + STEP
                if width >= MIN_WIDTH:
                    mid = start((run[0] + run[1]) / 2) + inward * run[2]
                    t = Vector((-inward.y, inward.x, 0))
                    entries.append({'at': Vector((mid.x, mid.y, 0)), 'normal': -inward, 'along': t, 'width': width})
                run = None
    # 柱で割れた 1 つの口 (b3 の東の吹き放し) をまとめる: 同じ向きで、間が MERGE_GAP 以内
    merged = []
    for e in sorted(entries, key=lambda e: (round(e['normal'].x, 2), round(e['normal'].y, 2), e['at'].dot(e['along']))):
        prev = merged[-1] if merged else None
        if prev and prev['normal'].dot(e['normal']) > 0.99:
            a0 = prev['at'].dot(prev['along']) - prev['width'] / 2
            a1 = prev['at'].dot(prev['along']) + prev['width'] / 2
            b0 = e['at'].dot(e['along']) - e['width'] / 2
            b1 = e['at'].dot(e['along']) + e['width'] / 2
            if b0 - a1 <= MERGE_GAP and abs((e['at'] - prev['at']).dot(prev['normal'])) < 0.5:
                lo_, hi_ = min(a0, b0), max(a1, b1)
                base = prev['at'] - prev['along'] * prev['at'].dot(prev['along'])
                prev['at'] = base + prev['along'] * ((lo_ + hi_) / 2)
                prev['width'] = hi_ - lo_
                continue
        merged.append(dict(e))
    return merged


def _ground(scene, dg, p):
    r = scene.ray_cast(dg, Vector((p.x, p.y, FOOT_Z + 0.4)), Vector((0, 0, -1)))
    return r[1].z if r[0] else 10.0


def entry_dirt(body_name, tag):
    body = bpy.data.objects[body_name]
    entries = find_entries(body)
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    name = f'vis_decal_b{tag}_entry_dirt_nouv'
    if name in bpy.data.objects:
        o = bpy.data.objects[name]; me = o.data
        bpy.data.objects.remove(o, do_unlink=True); bpy.data.meshes.remove(me)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    for e in entries:
        center, n, t, half = e['at'], e['normal'], e['along'], e['width'] / 2
        for direction, radius in ((1, half + OUT_RADIUS), (-1, IN_RADIUS)):
            # 半円の扇。真ん中 (敷居) が濃い (v = 1)、縁が薄い (v = 0)
            c = Vector((center.x, center.y, _ground(scene, dg, center + n * 0.3 * direction) + LIFT))
            cv = bm.verts.new(c)
            rim = []
            for k in range(SEGMENTS + 1):
                ang = math.pi * k / SEGMENTS
                dirv = t * math.cos(ang) + n * direction * math.sin(ang)
                # 口の幅ぶん横へ伸ばした楕円 (幅の広い口ほど横に広い)
                p = center + t * math.cos(ang) * (radius if direction > 0 else half + 0.2) + n * direction * math.sin(ang) * radius
                rim.append(bm.verts.new(Vector((p.x, p.y, _ground(scene, dg, p) + LIFT))))
            for k in range(SEGMENTS):
                f = bm.faces.new((cv, rim[k], rim[k + 1]))
                u0, u1 = k / SEGMENTS * 2, (k + 1) / SEGMENTS * 2
                for loop, val in zip(f.loops, ((0.5 * (u0 + u1), 0.98), (u0, 0.0), (u1, 0.0))):
                    loop[uv].uv = val
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(bpy.data.materials['decal_dirt'])
    return [(round(e['at'].x, 2), round(e['at'].y, 2), round(e['width'], 2)) for e in entries]


if globals().get('ENTRY_DIRT'):
    _c = ENTRY_DIRT
    print(entry_dirt(_c['body'], _c['tag']))
