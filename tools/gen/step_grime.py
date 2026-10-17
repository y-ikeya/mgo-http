# 建物の足元の段差 (縁) に泥の汚れを貼る。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/step_grime.py').read(), {'STEP_GRIME': {'body': 'concrete_building32', 'tag': '32', 'top': 10.09, 'cut': 10.05}})
#
#   body  本体
#   tag   名前に付ける番号 (vis_decal_b<tag>_step_grime_nouv)
#   top   段の上面の高さ (m)
#   cut   段の外周を取る高さ (m)。地面より上、段の上面より下
#
# 壁の汚れ (tools/gen/dirty.py) は段の上から始まるので、段そのもの (縁の正面と上の面) は
# 素のままだった (本人 2026-10-16)。絵は壁の汚れと同じ decal_grime の下の濃い所だけを使う。
import bpy, bmesh
from mathutils import Vector

E = 0.004  # 面から浮かせる量


def step_grime(body_name, tag, top, cut):
    ns = {}
    exec(open('/Users/yuma/workspace/mgo2http/tools/gen/flush_band.py').read(), ns)
    body = bpy.data.objects[body_name]
    # 段の輪は 1 つとは限らない (増築を合わせた b18 は 2 つ)
    rings = []
    for ring in ns['outline'](body, cut, all_loops=True):
        pts = []
        for p in ring:
            if not pts or (p - pts[-1]).length > 0.02:
                pts.append(p)
        if len(pts) > 1 and (pts[0] - pts[-1]).length < 0.02:
            pts.pop()
        if len(pts) >= 3:
            rings.append(pts)
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    name = f'vis_decal_b{tag}_step_grime_nouv'
    if name in bpy.data.objects:
        o = bpy.data.objects[name]; me = o.data
        bpy.data.objects.remove(o, do_unlink=True); bpy.data.meshes.remove(me)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')

    def quad(ps, uvs):
        f = bm.faces.new([bm.verts.new(p) for p in ps])
        for l, t in zip(f.loops, uvs):
            l[uv].uv = t

    made = 0
    edges = [(pts[i], pts[(i + 1) % len(pts)]) for pts in rings for i in range(len(pts))]
    for a, c in edges:
        d = c - a
        length = d.length
        if length < 0.08:
            continue
        t = d.normalized()
        n = Vector((t.y, -t.x, 0))  # 反時計回りの外周なので右手が外
        mid = (a + c) / 2
        r = scene.ray_cast(dg, Vector((mid.x, mid.y, 0)) + n * 0.15 + Vector((0, 0, top + 0.3)), Vector((0, 0, -1)))  # 上から引くと頭上の板 (b18 の路地の渡し板) に当たる
        ground = (r[1].z if r[0] else top - 0.1) - 0.02
        u1 = length / 2.3
        # 縁の正面 (段が地面より 1cm 以上高い所だけ)。絵の下の濃い所 (v 0 → 0.12)
        if ground < top - 0.01:
            p0 = Vector((a.x, a.y, ground)) + n * E
            p1 = Vector((c.x, c.y, ground)) + n * E
            quad([p0, p1, Vector((p1.x, p1.y, top)), Vector((p0.x, p0.y, top))], ((0, 0), (u1, 0), (u1, 0.12), (0, 0.12)))
        # 段の上の面。外の縁から奥の壁まで
        r = scene.ray_cast(dg, Vector((mid.x, mid.y, top + 0.06)) + n * 0.05, -n)
        depth = (Vector((r[1].x, r[1].y, 0)) - Vector((mid.x, mid.y, 0))).length if r[0] else 0.3
        depth = min(depth, 0.6)
        q0 = Vector((a.x, a.y, top + E)); q1 = Vector((c.x, c.y, top + E))
        quad([q0, q1, q1 - n * depth, q0 - n * depth], ((0, 0.04), (u1, 0.04), (u1, 0.2), (0, 0.2)))
        made += 1
    me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(bpy.data.materials['decal_grime'])
    # 縦の面は外へ、横の面は上へ揃える
    for p in me.polygons:
        if abs(p.normal.z) > 0.7 and p.normal.z < 0:
            p.flip()
    fix = {}
    exec(open('/Users/yuma/workspace/mgo2http/tools/gen/edge_wear.py').read(), fix)
    bpy.context.view_layer.update()
    return {'edges': made, 'faces': len(me.polygons), 'flipped': fix['fix_decal_normals'](o)}


if globals().get('STEP_GRIME'):
    _c = STEP_GRIME
    print(step_grime(_c['body'], _c['tag'], _c['top'], _c['cut']))
