# 箱の建物を「それっぽい」建物に組み直す: 窓の口・ガラス・閉めたシャッター・格子・窓台・
# 屋上の手すり壁 (パラペット)・縦樋。Blender の中で流す (MCP から exec)。
#
#   exec(open('tools/gen/facade.py').read(), {'FACADE': {...}})   (下の B28 が例)
#
# --- 決めごと (b9 / b10 に合わせた) ---
# - 本体は plaster_alley、UV は 1m で 0.5
# - 窓の口は壁から 0.3 掘る。ガラスは 0.16 奥 (b10 と同じ)、シャッターは 0.2 奥
# - ガラス・シャッターの UV は 1m で 1、黒い鉄は 1m で 2
# - 塞いだ窓 (kind='boards') は木の板を横に打ち付ける。板と隙間は wood_window6_south_boards と同じ
#   (高さ 0.272、隙間 0.02、木目の UV は 1m で 1.67)。長さは 1 枚ずつ少しずらす
# - **見えない面には窓を開けない。** 隣の建物に埋まっている所・接している所は箱のまま
# - 窓台・笠木は本体と別の物 (concrete_building◯_trim)。本体に混ぜると角の汚し
#   (edge_wear) が窓台の角まで拾う
#
# 本体の形は Boolean (EXACT) で掘ってから焼き付ける。元の形 (共有している箱の mesh) は触らない —
# 新しい mesh に差し替える
import bpy, bmesh, random
from mathutils import Vector

RECESS = 0.3
GLASS_IN = 0.16
SHUTTER_IN = 0.2
BAR_IN = 0.06
SILL_OUT, SILL_H, SILL_LIP = 0.06, 0.07, 0.05
COPING_OUT, COPING_H = 0.04, 0.08
PARAPET_W, PARAPET_H = 0.25, 0.5
BOARD_H, BOARD_GAP, BOARD_IN, BOARD_T = 0.272, 0.02, 0.04, 0.04
# 塞いだ窓の奥行き。板の隙間から奥が見えるので、0.3 だと 26cm 先に明るい壁があってハリボテと
# 分かる。部屋の奥行きぶん掘る (焼き込みの空の見え方で奥は暗くなる)
BOARDS_DEPTH = 1.5
# それでも奥の壁は外の壁と同じ明るさに照る (天空光はどこでも同じ)。壁の厚み (INTERIOR_FROM) より
# 奥を黒い内張りで覆って、暗い部屋に見せる
INTERIOR_FROM = 0.35


def _mat(name):
    return bpy.data.materials[name]


def _box(bm, lo, hi):
    """軸に揃った箱 (外向きの面)"""
    x0, y0, z0 = lo; x1, y1, z1 = hi
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                   (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in idx])


def _uv_world(bm, scale):
    """面の向きで投影する (壁は水平の位置と高さ、床・天井は x, y)"""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        for l in f.loops:
            p = l.vert.co
            if abs(n.z) > 0.7:
                t = (p.x, p.y)
            elif abs(n.x) > abs(n.y):
                t = (p.y * (1 if n.x > 0 else -1), p.z)
            else:
                t = (p.x * (-1 if n.y > 0 else 1), p.z)
            l[uv].uv = (t[0] * scale, t[1] * scale)


def _object(name, bm, mat, scale):
    bm.normal_update()
    _uv_world(bm, scale)
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(_mat(mat))
    return o


class Face:
    """壁 1 面。axis 'x' / 'y' が法線の軸、at がその座標、sign が外向き"""

    def __init__(self, axis, at, sign):
        self.axis, self.at, self.sign = axis, at, sign

    def p(self, u, z, d):
        """壁の上の点。u は壁に沿った座標 (世界の y か x)、d は外向きに +"""
        w = self.at + self.sign * d
        return Vector((w, u, z)) if self.axis == 'x' else Vector((u, w, z))

    def box(self, u0, u1, z0, z1, d0, d1):
        a, b = self.p(u0, z0, d0), self.p(u1, z1, d1)
        return (Vector(map(min, a, b)), Vector(map(max, a, b)))

    def quad(self, bm, u0, u1, z0, z1, d):
        pts = [self.p(u0, z0, d), self.p(u1, z0, d), self.p(u1, z1, d), self.p(u0, z1, d)]
        f = bm.faces.new([bm.verts.new(q) for q in pts])
        f.normal_update()
        want = Vector((self.sign, 0, 0)) if self.axis == 'x' else Vector((0, self.sign, 0))
        if f.normal.dot(want) < 0:
            f.normal_flip()


def build(cfg):
    name = cfg['body']
    lo, hi = Vector(cfg['min']), Vector(cfg['max'])
    faces = {'W': Face('x', lo.x, -1), 'E': Face('x', hi.x, 1), 'S': Face('y', lo.y, -1), 'N': Face('y', hi.y, 1)}

    # --- 本体: 箱から窓の口と屋上を掘る ---
    body = bpy.data.objects[name]
    bm = bmesh.new(); _box(bm, lo, hi)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    body.data = me
    body.matrix_world = body.matrix_world.Identity(4)
    me.materials.append(_mat('plaster_alley'))

    cut = bmesh.new()
    _box(cut, (lo.x + PARAPET_W, lo.y + PARAPET_W, hi.z - PARAPET_H), (hi.x - PARAPET_W, hi.y - PARAPET_W, hi.z + 1))
    for w in cfg['windows']:
        f = faces[w['face']]
        a, b = f.box(w['u0'], w['u1'], w['z0'], w['z1'], -w.get('depth', BOARDS_DEPTH if w.get('kind') == 'boards' else RECESS), 0.2)
        _box(cut, a, b)
    cme = bpy.data.meshes.new('_facade_cut'); cut.to_mesh(cme); cut.free()
    cutter = bpy.data.objects.new('_facade_cut', cme)
    bpy.context.scene.collection.objects.link(cutter)
    mod = body.modifiers.new('facade', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    body.modifiers.remove(mod)
    bpy.data.objects.remove(cutter, do_unlink=True); bpy.data.meshes.remove(cme)
    bm = bmesh.new(); bm.from_mesh(baked); bpy.data.meshes.remove(baked)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.001, verts=bm.verts, edges=bm.edges)
    bm.normal_update(); _uv_world(bm, 0.5)
    bm.to_mesh(me); bm.free()
    me.name = name

    tag = cfg['tag']
    # --- ガラス・シャッター・格子 ---
    glass, shutter, bars, trim, boards, interior = (bmesh.new() for _ in range(6))
    rnd = random.Random(cfg.get('seed', 28))
    for w in cfg['windows']:
        f = faces[w['face']]
        u0, u1, z0, z1 = w['u0'], w['u1'], w['z0'], w['z1']
        kind = w.get('kind', 'glass')
        if kind == 'shutter':
            a, b = f.box(u0, u1, z0, z1, -SHUTTER_IN - 0.02, -SHUTTER_IN)
            _box(shutter, a, b)
        elif kind == 'boards':
            # 窓の口の内側に収める。上の余りは最後の 1 枚を詰める
            z = z0 + 0.01
            while z < z1 - 0.06:
                top = min(z + BOARD_H, z1 - 0.01)
                j0, j1 = rnd.uniform(0, 0.03), rnd.uniform(0, 0.03)
                a, b = f.box(u0 + 0.01 + j0, u1 - 0.01 - j1, z, top, -BOARD_IN - BOARD_T, -BOARD_IN)
                _box(boards, a, b)
                z = top + BOARD_GAP
            depth = w.get('depth', BOARDS_DEPTH) - 0.005
            e = 0.005
            f.quad(interior, u0 + e, u1 - e, z0 + e, z1 - e, -depth)
            for d0, d1 in ((-INTERIOR_FROM, -depth),):
                # 上下と左右の内側の面 (内向き)
                for zz in (z0 + e, z1 - e):
                    pa, pb = f.p(u0 + e, zz, d0), f.p(u1 - e, zz, d1)
                    _box(interior, Vector(map(min, pa, pb)) - Vector((0, 0, 0.001)), Vector(map(max, pa, pb)) + Vector((0, 0, 0.001)))
                for uu in (u0 + e, u1 - e):
                    pa, pb = f.p(uu, z0 + e, d0), f.p(uu, z1 - e, d1)
                    lo_, hi_ = Vector(map(min, pa, pb)), Vector(map(max, pa, pb))
                    k = 0 if f.axis == 'y' else 1
                    lo_[k] -= 0.001; hi_[k] += 0.001
                    _box(interior, lo_, hi_)
        else:
            f.quad(glass, u0, u1, z0, z1, -GLASS_IN)
        if w.get('bars'):
            n = max(2, round((u1 - u0) / 0.12))
            for i in range(1, n):
                u = u0 + (u1 - u0) * i / n
                a, b = f.box(u - 0.01, u + 0.01, z0, z1, -BAR_IN - 0.02, -BAR_IN)
                _box(bars, a, b)
            for z in (z0 + 0.12, z1 - 0.12):
                a, b = f.box(u0, u1, z - 0.012, z + 0.012, -BAR_IN, -BAR_IN + 0.015)
                _box(bars, a, b)
        if w.get('sill', kind != 'shutter' or z0 > lo.z + 0.5) and z0 > cfg['ground'] + 0.3:
            a, b = f.box(u0 - SILL_LIP, u1 + SILL_LIP, z0 - SILL_H, z0, -0.02, SILL_OUT)
            _box(trim, a, b)
    # 笠木 (手すり壁の天端)。本体の外へ少し出す
    _box(trim, (lo.x - COPING_OUT, lo.y - COPING_OUT, hi.z), (hi.x + COPING_OUT, hi.y + COPING_OUT, hi.z + COPING_H))
    # 縦樋
    pipe = bmesh.new()
    for pp in cfg.get('pipes', []):
        f = faces[pp['face']]
        a, b = f.box(pp['u'] - 0.045, pp['u'] + 0.045, cfg['ground'], hi.z - 0.1, 0.03, 0.12)
        _box(pipe, a, b)
        a, b = f.box(pp['u'] - 0.045, pp['u'] + 0.045, hi.z - 0.19, hi.z - 0.1, -0.02, 0.12)
        _box(pipe, a, b)
    made = {}
    for obj_name, b_, mat, s in ((f'glass_{name[len("concrete_"):]}_panes_notexture', glass, 'dark_glass', 1.0),
                                 (f'metal_{name[len("concrete_"):]}_shutters', shutter, 'shutter', 1.0),
                                 (f'metal_{name[len("concrete_"):]}_bars', bars, 'dark_steel', 2.0),
                                 (f'wood_{name[len("concrete_"):]}_boards', boards, 'wood_frame', 1.67),
                                 (f'vis_{name[len("concrete_"):]}_interior_notexture', interior, 'wire_black', 1.0),
                                 (f'metal_{name[len("concrete_"):]}_pipe', pipe, 'dark_steel', 2.0),
                                 (f'{name}_trim', trim, 'plaster_alley', 0.5)):
        if len(b_.faces):
            made[obj_name] = _object(obj_name, b_, mat, s)
        else:
            b_.free()
    return {'body_faces': len(me.polygons), **{k: len(v.data.polygons) for k, v in made.items()}}


def _row(face, us, z0, z1, width, **kw):
    return [dict(face=face, u0=u - width / 2, u1=u + width / 2, z0=z0, z1=z1, **kw) for u in us]


# --- b28 (西の端の細長い 3 階建て) ---
# 南の 6.5m は concrete_roof1 に埋まっている。東は 1 階が b29 に接し、y 19.55〜24.2 は b29.001 が
# 15.09 まで、y 26.5〜 は b29.002 が覆う。西の路地と北の端が正面
F2 = (13.8, 15.2)   # 2 階の窓
F3 = (16.4, 17.3)   # 3 階の窓
B28 = {
    'body': 'concrete_building28', 'tag': 'b28', 'ground': 10.0,
    'min': (-53.814, 6.683, 9.8), 'max': (-49.36, 28.078, 18.056),
    'windows': (
        _row('W', (15.2, 22.0), *F2, 1.0) + _row('W', (18.6,), *F2, 1.0, kind='boards')
        + _row('W', (25.4,), *F2, 1.0)
        + _row('W', (15.2, 18.6, 22.0), *F3, 1.0) + _row('W', (25.4,), *F3, 1.0, kind='boards')
        + _row('W', (19.0 + 1.3,), 10.0, 12.6, 2.6, kind='shutter', sill=False)
        + _row('W', (15.2, 25.4), 11.3, 12.3, 0.8, bars=True)
        + _row('E', (17.6, 25.4), *F2, 1.0)
        + _row('E', (18.6, 25.4), *F3, 1.0) + _row('E', (22.0,), *F3, 1.0, kind='boards')
        + _row('N', (-51.587,), *F2, 1.0) + _row('N', (-51.587,), *F3, 1.0)
        + _row('N', (-51.587,), 11.3, 12.3, 0.8, bars=True)
    ),
    'pipes': [{'face': 'W', 'u': 13.75}, {'face': 'N', 'u': -53.45}],
}

if globals().get('FACADE'):
    print(build(FACADE if isinstance(FACADE, dict) else B28))
