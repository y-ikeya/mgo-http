# UU の白いビル (concrete_building_white) の東と西の面に窓を付ける (2026-11-05 本人「これがUUのwhiteの
# ビルの窓枠ね」、本家の画面: 2F の外の通路 (concrete_cube.005) に沿って窓が 4 つ、窓の前に横の格子が 6 本、
# 石の窓台、ガラスの真ん中に縦の桟と上寄りの横の桟、通路の端に梯子)。
#
#   窓 1 つ = 枠の石 (左右・上) + 窓台 + 暗いガラス + 桟 + 横の格子。vis_ … _noeye (素通り、視線も通す。
#   壁から 0.25m しか出ないので、当たりにすると通路で引っ掛かるだけ。見えている壁が視線を止める)
#
# 面は柱 (concrete_cube.003 / .004) で 3 つに分かれる。通路の階 (と上の階) は梯子 8 (y 16.7〜17.4) を避けて
# 窓を 3 つにする。材質は赤い建物の窓 (window_*) と同じ物を使う (色は足さない)。
#
# 西の面 (表、2F の地面の通路に面する) にも同じ窓。1 階の真ん中には入口の飾りを置く (同日「一階には入れない
# けど入口っぽい装飾」「こないだ作った glass_entrance_pane みたいなやつ」)。南の入口 (concrete_entrance_* /
# glass_entrance_* / metal_entrance_*、y -18 の壁) を写して 90° 回す。扉は開かない — 後ろは壁のまま
# 何度流しても同じ物になる。流し直すと前の物 (コレクション white_windows) を消して作り直す。
#   開いている Blender で: exec(open('tools/white_windows.py').read())
import bpy, bmesh, math
from mathutils import Matrix, Vector

COLLECTION = 'white_windows'
# 各階の窓の下端 (m)。通路 (上面 11.83) の階は 12.5 — 本家は窓台が膝より少し上
SILLS = (5.4, 8.95, 12.5, 16.05)
WIN_W, WIN_H = 1.2, 1.9
JAMB = 0.14          # 枠の石の幅
OUT = 0.16           # 枠の石が壁から出る量
BAR_OUT = 0.12       # 格子が壁から出る量
BARS = 6
LADDER8 = (16.6, 11.7)   # 梯子 8 の y の始まりと、梯子が始まる高さ (東の面)

# 入口 (西の面の 1 階)。南の入口 (扉 2 組) を写し、組を PAIRS まで横に足して広げる
# (2026-11-05 本人「入り口をもっと横に広くして」、両脇の窓を外して空けた所まで)
ENTRANCE_FROM = Vector((4.645, -18.05, 0.0))   # 南の入口の基準 (扉の並びの真ん中、壁の線、地面)
ENTRANCE_TO = Vector((7.63, 15.11, 0.0))
PAIRS = 5
PAIR_PITCH = 1.96          # 南の入口の扉の組の間隔 (x 2.7 → 4.66)
PAIR_A = (2.69, 4.55)      # 1 組目の扉 (ガラス・枠・取っ手) が入っている x
WIDEN = (PAIRS - 2) * PAIR_PITCH
ENTRANCE_Y = (15.11 - (4.49 + WIDEN) / 2, 15.11 + (4.49 + WIDEN) / 2)   # 柱を含む幅。1 階のここに窓を置かない


def line(y0, x0, y1, x1):
    """面の x を y から (面は少し傾いている)"""
    return lambda y: x0 + (y - y0) * (x1 - x0) / (y1 - y0)


# 面: 名前, 面の x, 外の向き (+1 = +x), 区画 (y の始まり, 終わり, 窓の数), 付けない列 (区画, 何番目)
FACES = (
    # 東。柱 (concrete_cube.003 / .004) で 3 つ。区画 C の 2 列目 (y 23.6〜25.2) は要らない (本人)
    ('east', line(2.5, 20.11, 25.9, 20.02), +1, ((2.5, 8.22, 2), (9.89, 18.35, 4), (20.03, 25.9, 2)), {(2, 1)}),
    # 西。表の面 (x 7.63) と、その南北で奥に引っ込んだ面 (x 9.14 / 9.22)
    ('west', line(2.6, 9.14, 8.32, 9.19), -1, ((2.6, 8.32, 2),), set()),
    ('west', line(8.31, 7.64, 21.92, 7.63), -1, ((8.31, 21.92, 5),), set()),
    ('west', line(21.91, 9.22, 25.92, 9.23), -1, ((21.91, 25.92, 1),), set()),
)


def fresh_collection():
    old = bpy.data.collections.get(COLLECTION)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    c = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(c)
    return c


def add_box(bm, lo, hi, mat):
    """軸に沿った箱 (lo, hi は世界の角)。面に材質の番号を付ける"""
    xs, ys, zs = (lo[0], hi[0]), (lo[1], hi[1]), (lo[2], hi[2])
    v = {(i, j, k): bm.verts.new((xs[i], ys[j], zs[k])) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
    for keys in (((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)), ((0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)),
                 ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), ((1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)),
                 ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)), ((0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1))):
        f = bm.faces.new([v[k] for k in keys])
        f.material_index = mat


FRAME, GLASS, SILL, BAR = 0, 1, 2, 3


def window(bm, wall_x, d, yc, z0):
    """窓 1 つ。wall_x = 面の x、d = 外の向き (±1)、yc = 窓の真ん中の y、z0 = 窓の下端"""
    x = wall_x(yc)

    def box(out0, y0, za, out1, y1, zb, mat):
        # 壁からの出 (out0〜out1) を x に直す
        xa, xb = x + d * out0, x + d * out1
        add_box(bm, (min(xa, xb), y0, za), (max(xa, xb), y1, zb), mat)

    y0, y1 = yc - WIN_W / 2, yc + WIN_W / 2
    z1 = z0 + WIN_H
    # 暗いガラス (壁のすぐ外)
    box(0, y0, z0, 0.02, y1, z1, GLASS)
    # 桟: 縦の真ん中と、上から 1/3 の横
    box(0, yc - 0.03, z0, 0.05, yc + 0.03, z1, FRAME)
    zt = z1 - WIN_H / 3
    box(0, y0, zt - 0.03, 0.05, y1, zt + 0.03, FRAME)
    # 枠の石 (左右・上)。窓の奥行きに見える
    box(0, y0 - JAMB, z0, OUT, y0, z1 + JAMB, SILL)
    box(0, y1, z0, OUT, y1 + JAMB, z1 + JAMB, SILL)
    box(0, y0, z1, OUT, y1, z1 + JAMB, SILL)
    # 窓台。枠より少し広く、前へ出る
    box(0, y0 - JAMB - 0.06, z0 - 0.16, 0.26, y1 + JAMB + 0.06, z0, SILL)
    # 横の格子 (枠の石の外で、左右の石に掛かる)
    for i in range(BARS):
        z = z0 + 0.22 + i * (WIN_H - 0.4) / (BARS - 1)
        box(BAR_OUT, y0 - 0.1, z - 0.018, BAR_OUT + 0.036, y1 + 0.1, z + 0.018, BAR)


def centers(y0, y1, n):
    return [y0 + (y1 - y0) * (i + 0.5) / n for i in range(n)]


def entrance(col):
    """南の入口を写して、西の面の 1 階に置く。+y を向いていた物を -x へ (z 回り +90°)。

    写す前に、南の入口の並び (x) の上で広げる: 1 組目の扉を PAIR_PITCH ずつ PAIRS 組に並べ、
    組の間の縦枠 (mullion) を足し、右の枠と柱を右へ寄せ、梁と段は右の端を伸ばす"""
    turn = Matrix.Rotation(math.pi / 2, 4, 'Z')
    center = ENTRANCE_FROM + Vector((WIDEN / 2, 0, 0))
    move = Matrix.Translation(ENTRANCE_TO) @ turn @ Matrix.Translation(-center)
    mid = ENTRANCE_FROM.x
    made = 0

    def place(src, name, shift=0.0, stretch=False):
        nonlocal made
        o = src.copy()
        o.data = src.data.copy()
        o.name = name
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(src.matrix_world)
        for v in o.data.vertices:
            if stretch:
                if v.co.x > mid:
                    v.co.x += WIDEN
            else:
                v.co.x += shift
        o.data.transform(move)
        col.objects.link(o)
        made += 1

    for src in list(bpy.data.objects):
        if src.type != 'MESH' or '_entrance_' not in src.name or 'white' in src.name:
            continue
        base = src.name.replace('_entrance_', '_entrance_white_')
        xs = [(src.matrix_world @ v.co).x for v in src.data.vertices]
        lo, hi = min(xs), max(xs)
        if 'mullion' in src.name:
            for k in range(PAIRS - 1):
                place(src, f'{base}.{k}', shift=k * PAIR_PITCH)
        elif 'header' in src.name or 'step' in src.name:
            place(src, base, stretch=True)
        elif lo > mid:
            # 右の枠・柱、2 組目の扉。2 組目は 1 組目を並べて作るので捨てる
            if 'jamb' in src.name or 'pillar' in src.name:
                place(src, base, shift=WIDEN)
        elif lo >= PAIR_A[0] and hi <= PAIR_A[1]:
            for k in range(PAIRS):
                place(src, f'{base}.p{k}', shift=k * PAIR_PITCH)
        else:
            place(src, base)
    return made


col = fresh_collection()
mats = [bpy.data.materials[n] for n in ('window_frame_offwhite', 'window_glass_dark', 'window_sill_stone', 'metal_fence_frame')]
count = 0
for side, wall_x, d, sections, skip in FACES:
    for fi, z0 in enumerate(SILLS):
        for si, (a, b, n) in enumerate(sections):
            if side == 'east' and si == 1 and z0 + WIN_H > LADDER8[1]:
                b, n = LADDER8[0] - 0.1, 3
            for wi, yc in enumerate(centers(a, b, n)):
                if (si, wi) in skip:
                    continue
                # 1 階の入口に掛かる窓は置かない
                if side == 'west' and fi == 0 and yc + WIN_W / 2 + JAMB > ENTRANCE_Y[0] and yc - WIN_W / 2 - JAMB < ENTRANCE_Y[1]:
                    continue
                name = f'vis_window_white_{side}_{fi + 1}_{yc:.1f}_noeye_notexture'
                me = bpy.data.meshes.new(name)
                bm = bmesh.new()
                window(bm, wall_x, d, yc, z0)
                bm.to_mesh(me)
                bm.free()
                for m in mats:
                    me.materials.append(m)
                o = bpy.data.objects.new(name, me)
                col.objects.link(o)
                count += 1
print('窓', count, '個 / 入口の部品', entrance(col), '個')
