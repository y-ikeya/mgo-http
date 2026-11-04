# UU の遊ぶ範囲の外に**遠景**を置く (2026-11-04 本人「それを参考に、君がてきとうに外のマップを作ってみてよ」
# 「city じゃなくて UU につくって」)。参考は street_city_7_for_games_free (dasy444) の団地の並び。形は借りて
# いない — 箱を積んだだけの低い物で、絵も読み込まない (UU にある材質を使い回す。色は足さない)。
#
# **今の遠景の正は stage_uu.blend。** これは最初に並べた生成器で、その後 .blend の上で本人が数を整え、
# 東側を寄せ、地上 (z 3.9、いわゆる 2F の床) へ上げ、地面を穴の空いた輪にし、外壁の絵を貼り (_nouv)、
# 輪郭を作り直した (tools/far_massing.py)。**流し直すと最初の形に戻るので流さない。**
#
# 全部 vis_ の札: 当たりも視線も弾も無い (export_stage.py の is_decoration)。遊びには一切効かない。
# 何度流しても同じ物になる (乱数の種が固定)。流し直すと前の遠景 (コレクション far) を消して作り直す。
#
#   開いている Blender で: exec(open('tools/far_scenery.py').read())
#   背景で:              $BLENDER -b tools/raw/stage_uu.blend --python tools/far_scenery.py
#
# --- 置き方 ---
# 遊ぶ範囲は外壁の内側 (x -37〜40, y -41〜41)、床は ±70 まで。外壁の上 (2F) や建物の屋上からだけ外が見える。
#   近く (中心から 80〜85) 2〜3 階の店・倉庫を外周に沿って。床の縁の外に道を挟んで街が続いて見えるように
#   中   (96〜135)         団地の板状棟 (10〜14 階) を碁盤の目に。目を間引き、向きを縦横で混ぜる
#   遠く (135〜160)        塔状の高い棟を混ぜる。空との境目に起伏を付ける
#
# **霧より手前に収める。** UU (clear) の霧は撮る所から 55m で掛かり始め 135m で空の色に沈む
# (presentation/scene/world/stage.ts の LOOKS)。遊ぶ範囲の端から 135m 先は見えないので、
# それより遠くに置いても描く手間だけ掛かる
# 床の外 (±70 より外) には低い所に広い地面を敷いて、建物が浮かないようにする
import bpy, bmesh, math, random

COLLECTION = 'far'
FLOOR = 3.0  # 1 階の高さ (m)
UV_METRES = 4.0  # 絵を何 m ごとに繰り返すか


def material(*names):
    for n in names:
        m = bpy.data.materials.get(n)
        if m:
            return m
    return None


WALLS = [material(n) for n in ('white_plaster_02', 'plastered_wall_04', 'concrete_slab_wall_02', 'concrete_wall_009')]
WALLS = [m for m in WALLS if m]
LOW = [m for m in (material('large_red_bricks'), material('brick_wall_10'), material('plastered_wall_04'), material('concrete_wall_009')) if m]
SLAB = material('concrete_untextured', 'concrete_slab_wall_02')
ROOF = material('concrete_untextured', 'concrete_wall_009')
GROUND = material('concrete_slab_wall_02', 'dirt_floor')
METAL = material('blue_metal_plate', 'metal_fence_frame')


def fresh_collection():
    old = bpy.data.collections.get(COLLECTION)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    c = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(c)
    return c


def box(bm, cx, cy, z0, sx, sy, sz, yaw, mat_index):
    """回した箱を bm に足す。UV は面の向きの平面へ投影して UV_METRES ごとに繰り返す"""
    c, s = math.cos(yaw), math.sin(yaw)
    pts = []
    for dz in (0, sz):
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            x, y = dx * sx / 2, dy * sy / 2
            pts.append(bm.verts.new((cx + x * c - y * s, cy + x * s + y * c, z0 + dz)))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    uv = bm.loops.layers.uv.verify()
    for f in faces:
        face = bm.faces.new([pts[i] for i in f])
        face.material_index = mat_index
        face.normal_update()
        n = face.normal
        for loop in face.loops:
            p = loop.vert.co
            if abs(n.z) > 0.7:
                loop[uv].uv = (p.x / UV_METRES, p.y / UV_METRES)
            elif abs(n.x) > abs(n.y):
                loop[uv].uv = (p.y / UV_METRES, p.z / UV_METRES)
            else:
                loop[uv].uv = (p.x / UV_METRES, p.z / UV_METRES)


def building(coll, name, mats, parts):
    """parts: [(cx, cy, z0, sx, sy, sz, yaw, 何番目の材質)]。1 棟 = 1 物"""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    for m in mats:
        mesh.materials.append(m)
    bm = bmesh.new()
    for p in parts:
        box(bm, *p)
    bm.to_mesh(mesh)
    bm.free()
    return obj


def danchi(coll, i, x, y, yaw, rnd):
    """団地の板状棟。廊下側の帯と、各階のベランダの張り出し、屋上の塔屋"""
    floors = rnd.randint(10, 14)
    length = rnd.uniform(45, 70)
    depth = 10.0
    h = floors * FLOOR
    parts = [(x, y, 0, length, depth, h, yaw, 0)]
    c, s = math.cos(yaw), math.sin(yaw)
    # ベランダの張り出し (正面側 +y)。階ごとの薄い帯が団地らしさの大半
    ox, oy = -s * (depth / 2 + 0.6), c * (depth / 2 + 0.6)
    for f in range(1, floors):
        parts.append((x + ox, y + oy, f * FLOOR - 0.15, length - 1.0, 1.2, 0.3, yaw, 1))
    # 屋上の塔屋 (階段室と給水塔)
    for k in range(rnd.randint(1, 3)):
        along = rnd.uniform(-length / 2 + 4, length / 2 - 4)
        parts.append((x + c * along, y + s * along, h, rnd.uniform(3, 5), rnd.uniform(3, 5), rnd.uniform(2.5, 4), yaw, 2))
    return building(coll, f'vis_concrete_far_danchi_{i:02d}', [rnd.choice(WALLS), SLAB, ROOF], parts)


def shop(coll, i, x, y, yaw, rnd):
    """2〜3 階の店・倉庫。1 階の庇と屋上の室外機"""
    floors = rnd.randint(2, 3)
    w, d = rnd.uniform(8, 16), rnd.uniform(8, 12)
    h = floors * FLOOR + 0.5
    c, s = math.cos(yaw), math.sin(yaw)
    parts = [(x, y, 0, w, d, h, yaw, 0)]
    # 1 階の庇 (道に向いた側 = 中心の方)
    ox, oy = -s * (d / 2 + 0.6), c * (d / 2 + 0.6)
    parts.append((x + ox, y + oy, 2.6, w - 0.6, 1.2, 0.2, yaw, 1))
    for k in range(rnd.randint(1, 3)):
        parts.append((x + rnd.uniform(-w / 3, w / 3) * c, y + rnd.uniform(-w / 3, w / 3) * s, h, 1.2, 0.8, 1.0, yaw, 2))
    return building(coll, f'vis_concrete_far_shop_{i:02d}', [rnd.choice(LOW), SLAB, METAL or SLAB], parts)


def tower(coll, i, x, y, rnd):
    floors = rnd.randint(18, 26)
    w = rnd.uniform(18, 26)
    h = floors * FLOOR
    parts = [(x, y, 0, w, w, h, 0, 0), (x, y, h, w * 0.4, w * 0.4, 4, 0, 1)]
    return building(coll, f'vis_concrete_far_tower_{i:02d}', [rnd.choice(WALLS), ROOF], parts)


def facing_centre(x, y):
    """正面 (+y 側) を真ん中へ向ける向き"""
    return math.atan2(-x, y) + math.pi


def build():
    rnd = random.Random(27)
    coll = fresh_collection()
    count = {'shop': 0, 'danchi': 0, 'tower': 0}
    # 広い地面。今の床 (±70、上面 0) より少し下に敷いて、床の外だけが見える
    building(coll, 'vis_concrete_far_ground', [GROUND], [(0, 0, -0.35, 400, 400, 0.2, 0, 0)])
    # 近く: 床の縁 (±70) のすぐ外に、外周に沿って店を並べる。道を挟んで向かいに街が続いて見える
    for side in range(4):
        base = side * math.pi / 2
        along = -96.0
        while along < 96:
            w = rnd.uniform(9, 15)
            r = 82 + rnd.uniform(-1.5, 3)
            x = math.cos(base) * r - math.sin(base) * along
            y = math.sin(base) * r + math.cos(base) * along
            if rnd.random() > 0.12:  # たまに空き地
                shop(coll, count['shop'], x, y, base + math.pi / 2, rnd)
                count['shop'] += 1
            along += w + rnd.uniform(1, 4)
    # 中と遠く: 碁盤の目に団地と塔。**目を間引き、向きを縦横で混ぜる** — 揃えて並べると外壁がもう 1 枚あるように見えた
    step = 46
    for gx in range(-4, 5):
        for gy in range(-4, 5):
            x = gx * step + rnd.uniform(-8, 8)
            y = gy * step + rnd.uniform(-8, 8)
            near = max(abs(x), abs(y))
            if near < 96 or near > 160:
                continue
            if rnd.random() < 0.2:
                continue
            if near > 132 and rnd.random() < 0.35:
                tower(coll, count['tower'], x, y, rnd)
                count['tower'] += 1
                continue
            yaw = rnd.choice((0.0, math.pi / 2)) + rnd.uniform(-0.04, 0.04)
            danchi(coll, count['danchi'], x, y, yaw, rnd)
            count['danchi'] += 1
    tris = sum(len(o.data.polygons) * 2 for o in coll.objects)
    print(f'[far] {len(coll.objects)} objects, ~{tris} tris, {count}')


build()
