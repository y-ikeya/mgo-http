# 角の欠けの板 (vis_decal_b◯_edge_nouv) を作る。Blender の中で流す (MCP から exec)。
#
#   EDGE_APPLY = ['3', '9', ...]   建物の番号 (concrete_building◯ が本体)
#   exec(open('tools/gen/edge_wear.py').read(), {'EDGE_APPLY': [...]})
#
# --- なぜ板か ---
# 壁の絵は 2m ごとに繰り返して使い回している (glb を小さく保つため) ので、特定の角だけを絵で
# 汚すことができない。建物 5 の角が「ボロく」見えたのは、繰り返しの絵の継ぎ目がたまたま角に
# 乗った偶然だった。同じ見え方を狙って出すために、外角の両面へ薄れる帯を貼る。
#
# --- 決めごと ---
# - 浮かせは 3mm。1cm だと角を斜めから見た時に板の縁が空に浮いて見えた。位置は float のまま
#   書き出す (gltfpack -vpf) ので 3mm でも壁と食い合わない
# - 板は角の手前 E まで延ばす。角の線で止めると 2 枚の間に壁の角が覗いて切れ目に見えた
# - 絵に格子の見える雑音を使わない。升目状の斑が縁に並び、動くとチリチリ見えた
# - 面は壁の外向きに揃える。裏向きだと影の normalBias が板を壁の中へ押し込む
import bpy, bmesh
import numpy as np
from mathutils import Vector

PATH = '/Users/yuma/workspace/mgo2http/tools/raw/decals/decal_edge.png'
W_PX, H_PX = 128, 512
W = 0.16          # 帯の幅 (m)
E = 0.003         # 壁から浮かせる量 (m)
MIN_SPAN = 1.0    # これより短い角 (基壇・庇の輪) には貼らない (m)


def make_texture():
    """角 (u=0) で濃く、u 0.8 で消える荒れた帯。滑らかな雑音を重ね、閾値では切らない"""
    yy, xx = np.mgrid[0:H_PX, 0:W_PX]
    u = xx / (W_PX - 1)

    def noise(fx, fy, seed):
        rs = np.random.RandomState(seed)
        g = rs.rand(fy + 2, fx + 2)
        ys = np.linspace(0, fy, H_PX, endpoint=False)
        xs = np.linspace(0, fx, W_PX, endpoint=False)
        y0 = np.floor(ys).astype(int)
        x0 = np.floor(xs).astype(int)
        fyy = (ys - y0)[:, None]
        fxx = (xs - x0)[None, :]
        fyy = fyy * fyy * (3 - 2 * fyy)      # smoothstep: 格子の角が出ない
        fxx = fxx * fxx * (3 - 2 * fxx)
        a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
        return a * (1 - fxx) * (1 - fyy) + b * fxx * (1 - fyy) + c * (1 - fxx) * fyy + d * fxx * fyy

    n = 0.45 * noise(2, 16, 1) + 0.3 * noise(5, 40, 2) + 0.25 * noise(12, 96, 3)
    base = np.clip(1.0 - u / 0.8, 0, 1) ** 1.6
    alpha = np.clip(base * (0.45 + 0.75 * n), 0, 1) * 0.85
    alpha[:, -1] = 0.0
    col = np.stack([0.20 + 0.08 * n, 0.17 + 0.07 * n, 0.13 + 0.06 * n], axis=-1)
    rgba = np.concatenate([col, alpha[..., None]], axis=-1).astype(np.float32)
    if 'decal_edge.png' in bpy.data.images:
        bpy.data.images.remove(bpy.data.images['decal_edge.png'])
    img = bpy.data.images.new('decal_edge.png', W_PX, H_PX, alpha=True)
    img.pixels = rgba[::-1].ravel().tolist()      # Blender は下の行から
    img.filepath_raw = PATH
    img.file_format = 'PNG'
    img.save()
    img.filepath = PATH
    img.source = 'FILE'
    img.reload()
    return img


def edge_material():
    img = bpy.data.images.get('decal_edge.png') or make_texture()
    if 'decal_edge' not in bpy.data.materials:
        m = bpy.data.materials['decal_grime'].copy()
        m.name = 'decal_edge'
    m = bpy.data.materials['decal_edge']
    for node in m.node_tree.nodes:
        if node.type == 'TEX_IMAGE':
            node.image = img
            node.extension = 'REPEAT'
    return m


def corner_spans(body, use_base=False):
    """本体の外角 (縦・凸・直角に近い辺) を (x, y) ごとに z の区間へまとめる。

    use_base: モディファイアを掛ける前の形で見る。小さな bevel が付いた箱は角が 45 度の面 2 枚になって
    直角の辺が無くなる (bevel は 1cm 未満なら書き出しで落ちるので、見た目は角のまま)
    """
    bm = bmesh.new()
    if use_base:
        bm.from_mesh(body.data)
    else:
        dg = bpy.context.evaluated_depsgraph_get()
        bm.from_mesh(body.evaluated_get(dg).data)
    bm.transform(body.matrix_world)
    bm.normal_update()
    spans = {}
    for e in bm.edges:
        a, b = e.verts[0].co, e.verts[1].co
        if abs(a.x - b.x) > 1e-3 or abs(a.y - b.y) > 1e-3 or abs(a.z - b.z) < 0.05:
            continue
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        n1, n2 = f1.normal, f2.normal
        if abs(n1.z) > 0.3 or abs(n2.z) > 0.3 or n1.dot(n2) > 0.5:
            continue
        if (f2.calc_center_median() - f1.calc_center_median()).dot(n1) >= 0:
            continue                               # 凹の辺 (窓の口の縁など)
        key = (round(a.x, 2), round(a.y, 2))
        spans.setdefault(key, {'n': (n1.copy(), n2.copy()), 'z': []})['z'].append((min(a.z, b.z), max(a.z, b.z)))
    bm.free()
    out = []
    for key, d in spans.items():
        zs = sorted(d['z'])
        merged = [list(zs[0])]
        for z0, z1 in zs[1:]:
            if z0 <= merged[-1][1] + 0.05:
                merged[-1][1] = max(merged[-1][1], z1)
            else:
                merged.append([z0, z1])
        for z0, z1 in merged:
            if z1 - z0 >= MIN_SPAN:
                out.append((key[0], key[1], z0, z1, d['n']))
    return out


def fix_decal_normals(obj):
    """板の面を、貼り付いている壁と反対向きに揃える (表と裏へ撃って近い方が貼り付いている壁)"""
    dg = bpy.context.evaluated_depsgraph_get()
    me = obj.data
    M = obj.matrix_world
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()

    def dist(c, d):
        o = c + d * 0.0005
        left = 0.15
        for _ in range(4):
            hit, loc, _n, _i, o2, _m = bpy.context.scene.ray_cast(dg, o, d, distance=left)
            if not hit:
                return None
            if o2.name.startswith('vis_'):
                left -= (loc - o).length + 0.0005
                o = loc + d * 0.0005
                continue
            return (loc - c).length
        return None

    flip = []
    for f in bm.faces:
        c = M @ f.calc_center_median()
        n = (M.to_3x3() @ f.normal).normalized()
        if abs(n.z) > 0.5:
            continue
        dp = dist(c, n)
        dm = dist(c, -n)
        if dp is None:
            continue
        if dm is None or dp < dm:
            flip.append(f)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
        bm.to_mesh(me)
        me.update()
    bm.free()
    return len(flip)


def make_edge_decals(body, tag, use_base=False):
    mat = edge_material()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    count = 0
    for x, y, z0, z1, (n1, n2) in corner_spans(body, use_base):
        c = Vector((x, y, 0))
        for n, other in ((n1, n2), (n2, n1)):
            t = Vector((-n.y, n.x, 0)).normalized()
            if t.dot(other) > 0:
                t = -t                             # 角からその面に沿って離れる向き
            p0 = c + n * E - t * E                 # 角の手前 E まで延ばす (2 枚が浮かせた分の角で出会う)
            za, zb = z0 + 0.02, z1 - 0.02
            pts = [p0 + Vector((0, 0, za)), p0 + t * (W + E) + Vector((0, 0, za)),
                   p0 + t * (W + E) + Vector((0, 0, zb)), p0 + Vector((0, 0, zb))]
            f = bm.faces.new([bm.verts.new(p) for p in pts])
            for loop, (uu, vv) in zip(f.loops, ((0, 0), (1, 0), (1, zb - za), (0, zb - za))):
                loop[uv].uv = (uu, vv)
            count += 1
    name = 'vis_decal_b%s_edge_nouv' % tag
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    if not count:
        bm.free()
        return None
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    bpy.context.view_layer.update()
    flipped = fix_decal_normals(o)
    return name, count, flipped


if globals().get('EDGE_APPLY'):
    for _tag in EDGE_APPLY:
        _body = bpy.data.objects.get('concrete_building%s' % _tag)
        if _body:
            print(_tag, make_edge_decals(_body, _tag))
