# concrete_cube.006 (2F の塀の塊) の上に、工事現場の目隠しを立てる (2026-11-04 本人「鉄の box の格子と
# それを覆うようにブルーシートがあって、ブルーシートにはちょっと皺が入ってる感じ」)。
#
#   足場   単管 (細い鉄の角材で代用) の柱・横の桟・筋交い。vis_ … _noeye — 素通り、視線も通す
#   シート 足場の外側に張る。vis_ — 人も弾もカメラも通すが、**視線は止める** (目隠し)。
#          平らな板に、皺と汚れを描いた絵を貼る (本家 MGO2 と同じ作り。形で皺を作ると重く、
#          書き出しの間引き・空の焼き込みで崩れた)。
#          皺は縦のたるみ (留め具の間で垂れる) と細かい揺らぎ。両面を描く
#
# 外壁 (concrete_wall1_2F) に付いている +x の面には立てない (塀と同じ 3 面)。
# 何度流しても同じ物になる。流し直すと前の物 (コレクション scaffold) を消して作り直す。
#   開いている Blender で: exec(open('tools/scaffold_sheet.py').read())
import bpy, bmesh, math, random
from mathutils import Vector

COLLECTION = 'scaffold'
BASE = 'concrete_cube.006'
HEIGHT = 2.6        # 塊の上から足場の上まで (m)
POST_STEP = 1.8     # 柱の間隔 (m)
PIPE = 0.05         # 単管の太さ (m)
INSET = 0.25        # 塊の縁から内へ (柱の位置)
SHEET_OUT = 0.14    # 柱の外へシートを出す量。皺で凹んでも単管 (半分 0.025) より外に居る
# 日に焼けて褪せた青 (linear)。絵の地の色。新品の発色 (0.03, 0.18, 0.62) は浮いた (2026-11-04 本人「発色良すぎる」)
SHEET_BLUE = (0.032, 0.08, 0.175, 1.0)
# 汚れの色 (linear)。茶色がかった灰
GRIME_RGB = (0.09, 0.08, 0.06)
# 絵の大きさ (幅, 高さ)。1 区画 (約 1.8m × 2.4m) に 1 枚
SHEET_TEX = (512, 640)


def fresh_collection():
    old = bpy.data.collections.get(COLLECTION)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    c = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(c)
    return c


def sheet_material():
    """ブルーシートの材質。絵 (sheet_image) を貼る。両面"""
    m = bpy.data.materials.get('blue_sheet') or bpy.data.materials.new('blue_sheet')
    m.use_nodes = True
    tree = m.node_tree
    bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = next((n for n in tree.nodes if n.type == 'TEX_IMAGE'), None) or tree.nodes.new('ShaderNodeTexImage')
    tex.image = sheet_image()
    tex.location = (bsdf.location.x - 320, bsdf.location.y)
    for l in list(bsdf.inputs['Base Color'].links):
        tree.links.remove(l)
    tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    m.use_backface_culling = False  # 内からも見える (書き出しで doubleSided)
    return m


def sheet_image():
    """1 区画ぶんの絵。上の 2 隅で留めて垂れたシートの襞と汚れを、陰影ごと描く。

    高さの場 h を作り、左上からの光で陰を付ける (本家と同じく絵に描いた陰):
      U 字の襞   上の 2 隅から垂れて真ん中が下がる。下ほど緩く広い
      隅の襞     上の隅から斜め下へ引かれる短い襞
      汚れ       谷に溜まる・上から垂れる筋・裾の跳ね返り・斑
    """
    import numpy as np
    W, H = SHEET_TEX
    img = bpy.data.images.get('blue_sheet_folds')
    if img and tuple(img.size) == (W, H):
        bpy.data.images.remove(img)
        img = None
    rng = np.random.default_rng(27)
    x = np.linspace(0, 1, W)[None, :].repeat(H, 0)
    y = np.linspace(0, 1, H)[:, None].repeat(W, 1)  # 0 = 下, 1 = 上
    # U 字の襞: 上の縁 (y=1) から垂れる弧。真ん中ほど深く垂れ、下ほど広く緩い (2〜3 本)
    # **ぴんと張った布** (2026-11-04 本人「U-shape がきつい、だらんとしてる。もう少しパリッと貼った
    # 感じで」)。垂れる弧は浅く上の方だけに、隅の留め具から引かれる斜めの張り皺を主にする。
    # 平らな板に描いた絵なので、深い襞を描くと板が平らなのと食い違って変に見える
    u = 0.08 + 4 * x * (1 - x)
    c = (1 - y) / u
    h = 0.35 * np.sin(c * 16.0 + 0.3 * np.sin(x * 4.0)) * np.exp(-c * 2.5) * np.clip((0.8 - c) / 0.4, 0, 1)
    # 張り皺: 上の 2 隅から斜め下へ、細く短く
    for cx, sgn in ((0.0, 1), (1.0, -1)):
        dx, dy = (x - cx) * sgn, 1 - y
        d = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx + 1e-6)
        h += 0.45 * np.sin(ang * 9.0) * np.exp(-d * 3.2) * np.clip(d * 15, 0, 1)
    # 下の 2 隅からも少し (下も留めてある)
    for cx, sgn in ((0.0, 1), (1.0, -1)):
        dx, dy = (x - cx) * sgn, y
        d = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx + 1e-6)
        h += 0.25 * np.sin(ang * 8.0) * np.exp(-d * 4.5) * np.clip(d * 15, 0, 1)
    # 布全体のゆるい波打ち (張っていても平らではない)
    for _ in range(4):
        fx, fy, ph = rng.uniform(0.6, 1.6), rng.uniform(0.5, 1.5), rng.uniform(0, 6.3)
        h += 0.05 * np.sin(x * fx * 6.28 + y * fy * 6.28 + ph)
    # 陰: 左上からの光
    gy, gx = np.gradient(h)
    shade = np.clip(0.76 - (gx * W * 0.7 - gy * H * 0.9) * 0.045, 0.4, 1.12)
    base = np.array(SHEET_BLUE[:3])
    col = base[None, None, :] * shade[..., None] * 1.0
    # 汚れ
    valley = np.clip(-h, 0, None)
    dirt = np.clip(valley * 1.2, 0, 0.5)
    streak = np.zeros_like(x)
    for _ in range(10):
        sx, sw, sk = rng.uniform(0, 1), rng.uniform(0.01, 0.04), rng.uniform(0.15, 0.4)
        streak += sk * np.exp(-((x - sx) / sw) ** 2) * y ** 1.5
    dirt += streak + 0.5 * (1 - y) ** 5
    mottle = 0.5 + 0.5 * np.sin(x * 5.1 + 1.3) * np.sin(y * 4.3 + 0.4)
    dirt += 0.12 * mottle
    dirt = np.clip(dirt, 0, 0.85)
    grime = np.array(GRIME_RGB)
    col = col * (1 - dirt[..., None]) + grime[None, None, :] * shade[..., None] * dirt[..., None]
    # 値は linear で作った。絵は sRGB で持つ (書き出しも sRGB の絵として渡す) ので符号化して入れる
    lin = np.clip(col, 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    rgba = np.concatenate([srgb, np.ones((H, W, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new('blue_sheet_folds', W, H, alpha=False)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = 'PNG'
    img.pack()
    return img


def box(bm, a, b, t):
    """a から b へ太さ t の角材"""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    z = d.normalized()
    x = z.cross(Vector((0, 0, 1)))
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    h = t / 2
    vs = []
    for s in (0, length):
        for cx, cy in ((-h, -h), (h, -h), (h, h), (-h, h)):
            vs.append(bm.verts.new(a + z * s + x * cx + y * cy))
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])


def frame_and_sheet(coll, tag, segments, top, rnd, sheet_side=1.0):
    """segments: [(a, b, out)]。a→b の線に柱を立て、out の向きへシートを出す。
    sheet_side=-1 なら out と逆 (内側) へ出す — 遊ぶ側から青が見えるように"""
    bm = bmesh.new()
    zs = (top + 0.15, top + HEIGHT / 2, top + HEIGHT - 0.05)
    for (sa, sb, out) in segments:
        sa, sb = Vector((*sa, 0)), Vector((*sb, 0))
        run = (sb - sa)
        n = max(1, round(run.length / POST_STEP))
        posts = [sa + run * (k / n) for k in range(n + 1)]
        for p in posts:
            box(bm, (p.x, p.y, top), (p.x, p.y, top + HEIGHT), PIPE)
        for z in zs:
            box(bm, (sa.x, sa.y, z), (sb.x, sb.y, z), PIPE)
        # 筋交い (1 区画おき)
        for k in range(0, n, 2):
            p, q = posts[k], posts[k + 1]
            box(bm, (p.x, p.y, top + 0.15), (q.x, q.y, top + HEIGHT - 0.05), PIPE * 0.8)
    name = f'vis_metal_scaffold{tag}_noeye'
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    frame = bpy.data.objects.new(name, mesh)
    frame.data.materials.append(bpy.data.materials.get('metal_fence_frame'))
    coll.objects.link(frame)

    # --- シート: 柱の間ごとに平らな板。皺は絵 (sheet_image) に描いてある (本家 MGO2 と同じ作り) ---
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    flip = False
    for (sa, sb, out) in segments:
        out = out * sheet_side
        sa, sb = Vector((*sa, 0)), Vector((*sb, 0))
        run = sb - sa
        n = max(1, round(run.length / POST_STEP))
        # **中が覗けないように隙間を作らない** (2026-11-04 本人「block の中が見えないように隙間なく」)。
        # 裾は塊の上面に付け、両端は隣の辺のシートと重なるまで伸ばす (角で SHEET_OUT ぶん開いていた)
        z0, z1 = top + 0.005, top + HEIGHT - 0.06
        reach = run.normalized() * (SHEET_OUT + 0.02)
        ends = [sa - reach + run * 0] + [sa + run * (k / n) for k in range(1, n)] + [sb + reach]
        for k in range(n):
            p = ends[k] + out * SHEET_OUT
            q = ends[k + 1] + out * SHEET_OUT
            vs = [bm.verts.new((p.x, p.y, z0)), bm.verts.new((q.x, q.y, z0)),
                  bm.verts.new((q.x, q.y, z1)), bm.verts.new((p.x, p.y, z1))]
            f = bm.faces.new(vs)
            # 1 区画おきに左右を返す。同じ柄が並ぶと貼った絵だと分かる
            us = (1, 0, 0, 1) if flip else (0, 1, 1, 0)
            for loop, uu, vv in zip(f.loops, us, (0, 0, 1, 1)):
                loop[uv].uv = (uu, vv)
            flip = not flip
    # 両面を描くので、法線は遊ぶ側 (out) を向いていれば足りる
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    name = f'vis_sheet_scaffold{tag}'
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    sheet = bpy.data.objects.new(name, mesh)
    sheet.data.materials.append(sheet_material())
    coll.objects.link(sheet)
    print(f'[scaffold{tag}] frame {len(frame.data.polygons)} faces, sheet {len(sheet.data.polygons)} faces, top {top:.2f}')


def build():
    base = bpy.data.objects[BASE]
    ws = [base.matrix_world @ v.co for v in base.data.vertices]
    x0, x1 = min(w.x for w in ws), max(w.x for w in ws)
    y0, y1 = min(w.y for w in ws), max(w.y for w in ws)
    top = max(w.z for w in ws)
    coll = fresh_collection()
    rnd = random.Random(6)
    # 3 辺: -y (x0→x1)、-x (y0→y1)、+y (x0→x1)。+x は外壁
    a1 = x1
    b0, b1 = y0 + INSET, y1 - INSET
    segments = [
        ((a1, b0), (x0 + INSET, b0), Vector((0, -1, 0))),
        ((x0 + INSET, b0), (x0 + INSET, b1), Vector((-1, 0, 0))),
        ((x0 + INSET, b1), (a1, b1), Vector((0, 1, 0))),
    ]
    frame_and_sheet(coll, '', segments, top, rnd)
    fence_colliders(coll, segments, top)
    build_corner(coll, rnd)


def fence_colliders(coll, segments, top):
    """シートの裏 (柱とシートの間) に見えない板。**人も弾も投げた物も止める** (2026-11-05 本人「たまもとめて
    人も手榴弾もとめて」)。シートは素通りなので、これが無いと塊の上から外へ歩いて出られた。
    視線はシートが止める。角は隣の板と重なるよう、両端を少し伸ばす"""
    bm = bmesh.new()
    for (sa, sb, out) in segments:
        a3, b3 = Vector((*sa, 0)), Vector((*sb, 0))
        run = b3 - a3
        mid = (a3 + b3) / 2 + out * 0.07
        add_box(bm, mid, run.length + 0.3, 0.1, top, top + HEIGHT, math.atan2(run.y, run.x))
    # cloth_: 撃つと布の音 (domain/stage/surface.ts)
    finish(bm, 'col_cloth_scaffold_fence_blockthrow', coll, None, uv=False)



# --- 2F の外壁の入隅 (x 25.5 / y 34.2 の角) ---------------------------------------
#
# 外壁 (concrete_wall1_2F) の 2 面 (高さ 9.54) を外して、塀 (上端 6.47) + 足場とシートにする
# (2026-11-04 本人「いま cursor がある角のところも block + ブルーシートで構成してくれる？」)。
# シートは遊ぶ側に向ける (青が見える)。シートは素通りなので、**人と投げた物が外へ出ないよう**
# 見えない板 (col_ … _blockthrow) を元の外壁の高さまで立てる。弾も止める (2026-11-05 本人、初めは通していた)
CORNER = [((25.49, 34.32), (25.46, 37.85)), ((25.49, 34.32), (28.35, 33.98))]
CORNER_INSIDE = Vector((-1, -1, 0)).normalized()  # 遊ぶ側
WALL_TOP = 6.47
OLD_TOP = 9.54
FLOOR_2F = 3.9
THICK = 0.2


def corner_wall_faces():
    """外壁から外す 2 面 (位置で探す。番号は直すと変わる)"""
    wall = bpy.data.objects['concrete_wall1_2F']
    m = wall.matrix_world
    out = []
    for p in wall.data.polygons:
        vs = [m @ wall.data.vertices[i].co for i in p.vertices]
        xy = {(round(v.x, 2), round(v.y, 2)) for v in vs}
        for a, b in CORNER:
            if xy == {a, b}:
                out.append(p.index)
    return wall, out


def build_corner(coll, rnd):
    wall, faces = corner_wall_faces()
    if faces:
        bm = bmesh.new()
        bm.from_mesh(wall.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in faces], context='FACES_ONLY')
        bm.to_mesh(wall.data)
        bm.free()
        print(f'[corner] 外壁から外した面: {len(faces)}')
    segs = []
    bm = bmesh.new()
    col = bmesh.new()
    for a, b in CORNER:
        a3, b3 = Vector((*a, 0)), Vector((*b, 0))
        run = b3 - a3
        normal = Vector((-run.y, run.x, 0)).normalized()
        if normal.dot(CORNER_INSIDE) > 0:
            normal = -normal  # 外へ
        # 塀は元の面を内側の面にして、外へ THICK の厚み
        mid = (a3 + b3) / 2 + normal * (THICK / 2)
        yaw = math.atan2(run.y, run.x)
        add_box(bm, mid, run.length + THICK, THICK, FLOOR_2F, WALL_TOP, yaw)
        add_box(col, mid, run.length + THICK, THICK, WALL_TOP, OLD_TOP, yaw)
        # 足場は塀の上の真ん中、シートは遊ぶ側 (-normal) へ
        top_mid = (a3 + b3) / 2 + normal * (THICK / 2)
        segs.append(((a3 + normal * (THICK / 2)).xy[:], (b3 + normal * (THICK / 2)).xy[:], normal))
    finish(bm, 'concrete_wall2_corner', coll, bpy.data.materials.get('concrete_slab_wall_02'), uv=True)
    finish(col, 'col_cloth_corner_fence_blockthrow', coll, None, uv=False)
    frame_and_sheet(coll, '_corner', [(tuple(a), tuple(b), n) for a, b, n in segs], WALL_TOP, rnd, sheet_side=-1.0)


def add_box(bm, mid, length, thick, z0, z1, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    vs = []
    for z in (z0, z1):
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            x, y = dx * length / 2, dy * thick / 2
            vs.append(bm.verts.new((mid.x + x * c - y * s, mid.y + x * s + y * c, z)))
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])


def finish(bm, name, coll, mat, uv):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if uv:
        layer = bm.loops.layers.uv.verify()
        for f in bm.faces:
            n = f.normal
            axis = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                w = l.vert.co
                # 他の塀と同じ: 2m ごとに絵 1 枚、横は x か y、縦は高さ
                l[layer].uv = (w.y / 2, w.z / 2) if axis == 0 else (w.x / 2, w.z / 2) if axis == 1 else (w.x / 2, w.y / 2)
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    if mat:
        obj.data.materials.append(mat)
    coll.objects.link(obj)


# 定義だけ読みたい時 (一部だけ作り直す) は先に SCAFFOLD_NO_BUILD = True
if not globals().get('SCAFFOLD_NO_BUILD'):
    build()
