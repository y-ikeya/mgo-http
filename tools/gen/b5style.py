# 箱の建物を、b5 (concrete_building5) と同じ作りの建物に建て直す。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/b5style.py').read(), {'B5STYLE': B12})   (下の B12 が例)
#
# 本人 2026-10-19「concrete_building5 の雰囲気好きなんだよね、12 と 12.001 で構成されるところも
# 君が建物作ってくれない?」「12, 12.001 をまとめた大きさの長方体の building でいいよ」。
#
# b5 は Blender の上で手で組んだ物で、作り方が残っていなかった。寸法は b5 を測って写した:
# - 本体は concrete_wall_new の箱。窓の口は隠した箱 (ref_cut_building◯) との Boolean の差で掘る
#   (幅 1.84 × 高さ 1.74、壁の 0.05 外から 0.30 奥まで)。角は 5mm のベベル
# - 階は 3.6m ごと。ガラスの下端は 基礎 + 1.0 / 4.6 / 8.2。窓は 1.6 × 1.5、ガラスは壁の 0.24 奥
# - 木枠 (wood_frame): 窓台 (0.06 出て 0.08 入る) と枠 4 本 (0.12 幅、0.02〜0.08 奥)
# - 障子 (wood_frame): ガラスの手前 0.18〜0.24 に、縁 4 本と十字の桟 (0.04 幅)
# - 1 階の窓だけ鉄格子 (dark_steel): 上下の枠 2 本 + 横 2 本 + 縦 5 本 (0.32 おき)
# - 帯 (concrete_wall_new、本体と別の物): 足元の基壇 0.5 (0.08 出)、各階の境 0.2 (0.10 出)、
#   屋上の笠木 0.45 (0.06 出)。扉の所は基壇を切る
# - 扉は b5 の扉 (wood_Door_b5_entry と枠) の形をそのまま使う (形は共有)
#
# 本体の絵 (concrete_wall_new) は b5 では面ごとに 0..1 の UV で、16m の面に 1 枚が伸びている。
# 長い面に同じ貼り方をすると横に伸びるので、**b5 と同じ密度** (横 16.4m・縦 11.7m で 1 枚) で
# 世界の座標から貼る。
#
# 見えない面には窓を開けない: 窓の前 1.2m に何か (隣の建物) があれば、その窓は箱のまま。
import bpy, bmesh
from mathutils import Vector

F = {}
exec(open('/Users/yuma/workspace/mgo2http/tools/gen/facade.py').read(), F)
_box, _uv_world = F['_box'], F['_uv_world']

FLOOR_H = 3.6
SILL_FROM_BASE = 1.0
WIN_W, WIN_H = 1.6, 1.5
CUT_HALF, CUT_BELOW, CUT_ABOVE, CUT_OUT, CUT_IN = 0.92, 0.12, 0.12, 0.05, 0.30
GLASS_IN = 0.24
BODY_U, BODY_V = 16.4, 11.68
BLOCKED = 1.2
DOOR_PLINTH_GAP = 0.67

B12 = {
    'name': 'concrete_building12', 'tag': '12',
    # b12 と b12.001 をまとめた大きさ。南は b32.004 (北の端 78.48) に食い込まないよう 78.6 から
    'min': (-40.95, 78.6), 'max': (23.42, 90.73),
    'base': 9.9, 'top': 21.58,
    # 面ごとの窓の数と間隔 (b5 の南の面は 4.4、西の面は 4.95)
    'windows': {'S': (13, 4.6), 'N': (13, 4.6), 'W': (2, 4.95), 'E': (2, 4.95)},
    # 1 階で窓の代わりに扉にする所 (面と、その面の窓の番号)
    'doors': [('S', 6)],
    'remove': ['concrete_building12', 'concrete_building12.001'],
    # 渡り廊下 (BRIDGE12) が取り付く所。ここに掛かる窓は開けない
    'keep_clear': [((-2.35, 78.0, 13.53), (-0.35, 79.0, 16.71))],
}

# 渡り廊下。b12 の南の面と b9 の北の面 (2 階のガラス窓の所) をつなぐ。本人 2026-10-19
# 「Cube.005 みたいな渡り廊下を作ってくれない? 12 にくっつけていいから」。置いてあった箱
# (Cube.005) の大きさで、b9 の窓 (中心 x -1.35) に合わせて 5cm 動かした。両端は 20cm ずつ壁に
# 食い込ませる (つなぎ目に隙間を作らない)。窓は東西の面に 2 つずつ、1 階ではないので格子は無し
BRIDGE12 = {
    'name': 'concrete_building12_bridge', 'tag': '12_bridge',
    'min': (-2.35, 73.36), 'max': (-0.35, 78.81),
    'base': 13.53, 'top': 16.71,
    'sills': [14.35],
    'windows': {'W': (2, 2.3), 'E': (2, 2.3)},
    'span': (73.56, 78.6),
    'bands': [(13.53, 13.73, 0.10), (16.66, 17.01, 0.06)],
    'band_faces': ['W', 'E'],
    'bars': False,
    'remove': ['Cube.005'],
}


class Face:
    """壁 1 面。u は面に沿った座標、d は外向きを正とする壁からの距離"""

    def __init__(self, key, lo, hi):
        self.key = key
        if key in ('S', 'N'):
            self.axis, self.u0, self.u1 = 'y', lo.x, hi.x
            self.wall, self.sign = (lo.y, -1) if key == 'S' else (hi.y, 1)
        else:
            self.axis, self.u0, self.u1 = 'x', lo.y, hi.y
            self.wall, self.sign = (lo.x, -1) if key == 'W' else (hi.x, 1)

    def point(self, u, d, z):
        w = self.wall + self.sign * d
        return Vector((u, w, z)) if self.axis == 'y' else Vector((w, u, z))

    def box(self, bm, u0, u1, d0, d1, z0, z1):
        a, b = self.point(u0, d0, z0), self.point(u1, d1, z1)
        _box(bm, Vector([min(a[i], b[i]) for i in range(3)]), Vector([max(a[i], b[i]) for i in range(3)]))

    def normal(self):
        return Vector((0, self.sign, 0)) if self.axis == 'y' else Vector((self.sign, 0, 0))

    def yaw(self):
        """b5 の扉は +x を向いて置いてある。この面を向かせる回転"""
        return {'E': 0.0, 'N': 1.5708, 'W': 3.1416, 'S': -1.5708}[self.key]


def _link(name, me, mods_from=None):
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if mods_from:
        for m in bpy.data.objects[mods_from].modifiers:
            if m.type == 'BEVEL':
                n = o.modifiers.new(m.name, 'BEVEL')
                for k in ('width', 'segments', 'limit_method', 'angle_limit', 'offset_type', 'affect'):
                    setattr(n, k, getattr(m, k))
    return o


def _part(name, bm, mat, scale, mods_from=None):
    bm.normal_update()
    _uv_world(bm, scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(bpy.data.materials[mat])
    return _link(name, me, mods_from)


def _blocked(face, u, z):
    """窓の前 BLOCKED に何かあるか (隣の建物に向いた窓は開けない)"""
    dg = bpy.context.evaluated_depsgraph_get()
    hit = bpy.context.scene.ray_cast(dg, face.point(u, 0.05, z), face.normal(), distance=BLOCKED)
    return hit[0]


def _clear(cfg, face, u, zg):
    """窓の口 (木枠の外まで) が、開けない範囲 (keep_clear) に掛かるか"""
    a = face.point(u - 0.95, -CUT_IN, zg - 0.15)
    b = face.point(u + 0.95, CUT_OUT + 0.1, zg + WIN_H + CUT_ABOVE)
    lo = [min(a[i], b[i]) for i in range(3)]
    hi = [max(a[i], b[i]) for i in range(3)]
    for k0, k1 in cfg.get('keep_clear', []):
        if all(lo[i] < k1[i] and hi[i] > k0[i] for i in range(3)):
            return True
    return False


def build(cfg):
    # 前に作った物も消す。残っていると、窓の前に格子や窓枠がある = 塞がっている、と読んで窓を開けない
    tag = cfg['tag']
    made = ['ref_cut_building%s' % tag, 'concrete_building%s_trim' % tag, 'wood_building%s_frames' % tag,
            'wood_building%s_sashes' % tag, 'glass_building%s_panes_notexture' % tag, 'metal_building%s_bars' % tag]
    for o in list(bpy.data.objects):
        if o.name in cfg.get('remove', []) or o.name in made or o.name.startswith('wood_Door_b%s_' % tag) \
                or o.name.startswith('vis_decal_b%s_' % tag):
            bpy.data.objects.remove(o, do_unlink=True)
    lo = Vector((cfg['min'][0], cfg['min'][1], cfg['base']))
    hi = Vector((cfg['max'][0], cfg['max'][1], cfg['top']))
    base, top = cfg['base'], cfg['top']
    faces = {k: Face(k, lo, hi) for k in ('S', 'N', 'W', 'E')}
    sills = cfg.get('sills') or [base + SILL_FROM_BASE + i * FLOOR_H for i in range(3)]

    # 窓と扉の位置
    openings = []          # (face, u, floor)
    doors = []             # (face, u)
    door_at = set(cfg.get('doors', []))
    for key, (n, step) in cfg['windows'].items():
        f = faces[key]
        # 面の中で窓を並べる範囲 (渡り廊下は両端が壁に食い込むので、見えている所だけ)
        a, b = cfg['span'] if key in ('W', 'E') and 'span' in cfg else (f.u0, f.u1)
        mid = (a + b) / 2
        for i in range(n):
            u = mid + (i - (n - 1) / 2) * step
            for floor, zg in enumerate(sills):
                if _clear(cfg, f, u, zg):
                    continue
                if floor == 0 and (key, i) in door_at:
                    doors.append((f, u))
                    continue
                if _blocked(f, u, zg + WIN_H / 2):
                    continue
                openings.append((f, u, floor))

    # 本体 (b5 と同じく箱 + ベベル + 窓の口の Boolean)。
    # **壁は格子に割っておく。** 部屋の暗さは頂点ごとに焼くので (書き出しの --bake)、64m の壁が
    # 数枚の三角だと、その値が三角の中で伸びて壁に大きな斜めの明暗が出た。窓の間 (と端) と
    # 各階の境で割る
    bm = bmesh.new()
    _box(bm, lo, hi)
    cuts = []
    for key, (n, step) in cfg['windows'].items():
        f = faces[key]
        a, b = cfg['span'] if key in ('W', 'E') and 'span' in cfg else (f.u0, f.u1)
        mid = (a + b) / 2
        us = [mid + (i - (n - 1) / 2) * step for i in range(n)]
        lines = [(a + b) / 2 for a, b in zip(us, us[1:])]
        if us:
            lines += [us[0] - step / 2, us[-1] + step / 2]
        cuts.append((f.axis, [u for u in lines if f.u0 + 0.3 < u < f.u1 - 0.3]))
    zs = [z - 0.95 for z in sills[1:]] + [base + 0.5, top - 0.05]
    for axis, lines in cuts:
        # 面に沿った軸 ('y' の面なら x で割る)
        along = 0 if axis == 'y' else 1
        for u in sorted(set(round(v, 4) for v in lines)):
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            no = Vector((1, 0, 0)) if along == 0 else Vector((0, 1, 0))
            co = Vector((u, 0, 0)) if along == 0 else Vector((0, u, 0))
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
    for z in zs:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, 0, z)), plane_no=Vector((0, 0, 1)))
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    for face in bm.faces:
        n = face.normal
        for l in face.loops:
            p = l.vert.co
            if abs(n.z) > 0.7:
                t = (p.x / BODY_U, p.y / BODY_U)
            elif abs(n.x) > abs(n.y):
                t = (p.y * (1 if n.x > 0 else -1) / BODY_U, (p.z - base) / BODY_V)
            else:
                t = (p.x * (-1 if n.y > 0 else 1) / BODY_U, (p.z - base) / BODY_V)
            l[uv].uv = t
    me = bpy.data.meshes.new(cfg['name'])
    bm.to_mesh(me); bm.free()
    me.materials.append(bpy.data.materials['concrete_wall_new'])
    body = _link(cfg['name'], me, 'concrete_building5')

    cut = bmesh.new()
    for f, u, floor in openings:
        zg = sills[floor]
        f.box(cut, u - CUT_HALF, u + CUT_HALF, -CUT_IN, CUT_OUT, zg - CUT_BELOW, zg + WIN_H + CUT_ABOVE)
    ref = _part('ref_cut_building%s' % tag, cut, 'concrete_wall_new', 1.0)
    ref.hide_render = True
    ref.display_type = 'WIRE'
    mod = body.modifiers.new('Boolean', 'BOOLEAN')
    mod.solver = 'EXACT'; mod.operation = 'DIFFERENCE'; mod.object = ref

    # 帯。長い面 (S, N) は角まで回して、短い面と合わせて角を閉じる
    trim = bmesh.new()
    bands = cfg.get('bands') or ([(base, base + 0.5, 0.08)] + [(z - 1.05, z - 0.85, 0.10) for z in sills[1:]]
                                 + [(top - 0.05, top + 0.40, 0.06)])
    for f in (faces[k] for k in cfg.get('band_faces', ['S', 'N', 'W', 'E'])):
        for z0, z1, out in bands:
            u0, u1 = (f.u0 - out, f.u1 + out) if f.key in ('S', 'N') else (f.u0, f.u1)
            gaps = sorted(u for g, u in doors if g is f) if z0 == base else []
            for du in gaps:
                f.box(trim, u0, du - DOOR_PLINTH_GAP, 0, out, z0, z1)
                u0 = du + DOOR_PLINTH_GAP
            f.box(trim, u0, u1, 0, out, z0, z1)
    _part('concrete_building%s_trim' % tag, trim, 'concrete_wall_new', 0.5)

    # 窓の中身
    frames, sashes, glass, bars = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    hw = WIN_W / 2
    for f, u, floor in openings:
        zg = sills[floor]
        # 木枠: 窓台と枠 4 本
        f.box(frames, u - 0.95, u + 0.95, -0.08, 0.06, zg - 0.15, zg - 0.09)
        f.box(frames, u - CUT_HALF, u + CUT_HALF, -0.08, -0.02, zg - 0.12, zg)
        f.box(frames, u - CUT_HALF, u + CUT_HALF, -0.08, -0.02, zg + WIN_H, zg + WIN_H + 0.12)
        f.box(frames, u - CUT_HALF, u - hw, -0.08, -0.02, zg, zg + WIN_H)
        f.box(frames, u + hw, u + CUT_HALF, -0.08, -0.02, zg, zg + WIN_H)
        # 障子: 縁 4 本と十字の桟
        f.box(sashes, u - hw, u + hw, -GLASS_IN, -0.18, zg, zg + 0.04)
        f.box(sashes, u - hw, u + hw, -GLASS_IN, -0.18, zg + WIN_H - 0.04, zg + WIN_H)
        f.box(sashes, u - hw, u - hw + 0.04, -GLASS_IN, -0.18, zg, zg + WIN_H)
        f.box(sashes, u + hw - 0.04, u + hw, -GLASS_IN, -0.18, zg, zg + WIN_H)
        f.box(sashes, u - hw, u + hw, -0.22, -0.18, zg + 0.73, zg + 0.77)
        f.box(sashes, u - 0.02, u + 0.02, -0.22, -0.18, zg, zg + WIN_H)
        # ガラス
        f.box(glass, u - hw, u + hw, -GLASS_IN - 0.01, -GLASS_IN, zg, zg + WIN_H)
        # 1 階だけ鉄格子
        if floor == 0 and cfg.get('bars', True):
            f.box(bars, u - 0.88, u + 0.88, 0, 0.08, zg - 0.09, zg - 0.03)
            f.box(bars, u - 0.88, u + 0.88, 0, 0.08, zg + 1.53, zg + 1.59)
            f.box(bars, u - 0.85, u + 0.85, 0.03, 0.07, zg + 0.44, zg + 0.47)
            f.box(bars, u - 0.85, u + 0.85, 0.03, 0.07, zg + 1.03, zg + 1.07)
            for k in range(-2, 3):
                c = u + k * 0.32
                f.box(bars, c - 0.01, c + 0.01, 0.03, 0.07, zg - 0.06, zg + 1.56)
    _part('wood_building%s_frames' % tag, frames, 'wood_frame', 1.25, 'wood_building5_frames')
    _part('wood_building%s_sashes' % tag, sashes, 'wood_frame', 1.25, 'wood_building5_sashes')
    _part('glass_building%s_panes_notexture' % tag, glass, 'dark_glass', 1.0)
    if len(bars.verts):
        _part('metal_building%s_bars' % tag, bars, 'dark_steel', 2.0, 'metal_building5_bars')
    else:
        bars.free()

    # 扉 (b5 の扉の形を共有する)
    for i, (f, u) in enumerate(doors):
        for src, suffix in (('wood_Door_b5_entry', ''), ('wood_Door_b5_entry_frame', '_frame')):
            name = 'wood_Door_b%s_entry%s%s' % (tag, '' if i == 0 else '_%d' % i, suffix)
            o = _link(name, bpy.data.objects[src].data)
            o.location = f.point(u, 0, base + 0.1)
            o.rotation_euler = (0, 0, f.yaw())
    return {'windows': len(openings), 'doors': len(doors), 'bars': sum(1 for o in openings if o[2] == 0)}


if globals().get('B5STYLE'):
    print(build(B5STYLE if isinstance(B5STYLE, dict) else B12))
    if B5STYLE is True:
        print(build(BRIDGE12))
