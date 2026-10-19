# b18 の南側を四角く作り直す。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/square_b18_south.py').read(), {'SQUARE_B18_SOUTH': True})
#
# 本人 2026-10-19「南側の建物の構造が不自然になってるところ、ちゃんと四角くして」
# 「元々あった斜めに切ってる面は残しておいて」。
# 増築 (extend_b18.py) と、斜めの棟 (concrete_building20) と張り出し (Cube.005) を
# 合わせた (absorb_into_b18.py) 結果、南側に斜めの棟・三角の隙間・南東へはみ出した角が残っていた。
#
# --- やること ---
# 1. 路地の南の壁の線 (y = SOUTH_FROM) より南を、本体からごっそり削る (Boolean の差)
# 2. 削った所にあった窓の中身 (ガラス・格子・板・黒い内張り) も消す
# 3. 四角い箱 (RECT) を、b18 と同じ作り (高さ・足元の段・前が開けた面だけ窓) で合わせ直す
#    (absorb_into_b18.py の absorb に任せる)
# 4. 西の通りの上の 2 階の張り出し (OVERHANG) を戻す (1 で一緒に削れる)
# 5. 屋上を掘り直し、面をまとめて UV を付け直す (absorb の roof / finish)
import bpy, bmesh
from mathutils import Vector

# 路地の南の壁は y = -17.01。**ちょうどそこで削ると、壁と同じ面で切ることになって面が抜けた**
# (開いた辺 33 本)。壁の 30cm 内側 (CUT_AT) で削り、作り直す箱はそこへ 10cm 食い込ませる (JOIN_AT)
CUT_AT = -17.31
JOIN_AT = -17.21
# 作り直す形 (反時計回り)。**元の斜めの棟 (concrete_building20) の斜めの面は残す** — 西の壁の線
# (x = -3.88) から元の南西の面に沿って南の角 (1.74, -27.36) へ、元の南の短い面で (3.72, -25.7) へ、
# そこから東の壁の線 (x = 16.47) まで真っ直ぐ。南東に斜めにはみ出していた角と三角の隙間は消える。
# 南の面は南の隣 (concrete_building24.003、北の面 y = -26.5) から 0.8m 離れる (足元の段 0.3m を足しても付かない)
RECT = [(-3.88, -20.64), (1.74, -27.36), (3.72, -25.7), (16.47, -25.7), (16.47, JOIN_AT), (-3.88, JOIN_AT)]
# 西の通りの上の 2 階の張り出し (Cube.005 の南の端まで)
OVERHANG = [(-5.72, -20.46), (-3.88, -20.46), (-3.88, JOIN_AT), (-5.72, JOIN_AT)]
# 削る範囲 (世界の座標)。南の隣の建物に触れないよう、本体の外接より少し広いだけ
CUT_LO = Vector((-8.0, -28.5, 0.0))
CUT_HI = Vector((19.0, CUT_AT, 40.0))
SOUTH_FROM = CUT_AT
PARTS = ['glass_building18_panes_notexture', 'metal_building18_bars',
         'wood_building18_boards', 'vis_building18_interior_notexture']

ab = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/absorb_into_b18.py').read(), ab)
bu = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/board_up.py').read(), bu)


def _inside(p):
    return all(CUT_LO[i] <= p[i] <= CUT_HI[i] for i in range(3))


def cut_body():
    body = bpy.data.objects['concrete_building18']
    bm = bmesh.new()
    lo, hi = CUT_LO, CUT_HI
    v = [bm.verts.new((x, y, z)) for z in (lo.z, hi.z) for y in (lo.y, hi.y) for x in (lo.x, hi.x)]
    for idx in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        bm.faces.new([v[i] for i in idx])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('_cut'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('_cut', me); bpy.context.scene.collection.objects.link(ob)
    mod = body.modifiers.new('cut', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = ob
    mod.use_self = True; mod.use_hole_tolerant = True
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    body.modifiers.remove(mod); bpy.data.objects.remove(ob, do_unlink=True); bpy.data.meshes.remove(me)
    old = body.data; name = old.name
    for i, m in enumerate(old.materials):
        if i >= len(baked.materials):
            baked.materials.append(m)
    body.data = baked
    if old.users == 0:
        bpy.data.meshes.remove(old)
    baked.name = name


def clear_parts():
    """削った範囲にある窓の中身を、ひとかたまりずつ消す"""
    removed = {}
    for name in PARTS:
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        drop = set()
        for lo, hi, verts, _ in bu['_components'](obj):
            if _inside((lo + hi) / 2):
                drop |= verts
        if not drop:
            continue
        bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context='VERTS')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
        removed[name] = len(drop)
    return removed


def _stub(name):
    """absorb に渡す仮の物 (形は使われない。outline と高さで組み直す)"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return name


def build():
    cut_body()
    report = {'cleared': clear_parts()}
    report['rect'] = ab['absorb'](_stub('_b18_south'), {
        'windows': True, 'plinth': True, 'outline': RECT, 'z0': ab['BOTTOM'], 'z1': ab['TOP'],
    })
    report['overhang'] = ab['absorb'](_stub('_b18_overhang'), {
        'windows': True, 'outline': OVERHANG, 'z0': 13.1, 'z1': ab['TOP'],
    })
    ab['roof']()
    ab['finish']()
    return report


if globals().get('SQUARE_B18_SOUTH'):
    print(build())
