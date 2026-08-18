# ステージの叩き台を作る。
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/make_stage.py
#
# **既にある stage.blend は上書きしない。** これは白紙から叩き台を起こすためのもので、
# 普段の改修は Blender で stage.blend を直接いじり、export_stage.py で書き出す。
# 作り直したいときは stage.blend を自分で消すか名前を変えてから走らせる。
#
# .blend と glb の両方を書き出す。glb はそのままゲームに乗るので、まず歩いて確かめてから
# .blend を開いて箱を動かす、という順で進められる。
#
# 座標は Blender 基準 (X 右 / Y 奥 / Z 上、単位はメートル)。
# glTF に出るときに Y と Z が入れ替わるが、書き出し側が面倒を見るのでここでは気にしない。
#
# --- 作る上での制約 ---
# 当たり判定は XZ 平面の AABB + 上面と下面の高さ。つまり:
#   * 軸に沿った箱だけ。回した壁は回す前の箱として判定される
#   * 斜面は上面の傾き (書き出しが頂点から測る) か、段の積み重ねで作る
#
# **屋根とアーチは架けられる。** 箱は下面を持つので、体 (1.8m) より上に浮かせれば
# その下をくぐれる。2 階の床も同じ。跳ねて上がると下面にぶつかって止まる。
#
# 中途半端に浮かせると、下が空いて見えるのに通れない箱になる。乗るための台なら
# STEP_UP (0.25m) 以下に、くぐらせるなら 1.8m 以上に離す。書き出しが警告する。
#
# --- 名前で宣言するもの ---
#   col_◯◯      判定だけ (描画しない)
#   vis_◯◯      描画だけ (判定しない)
#   metal_◯◯    錆びた金属。見た目と足音の両方が変わる
#   concrete_◯◯ コンクリート
#   wood_◯◯     木。撃ち合いの場に置く小さめの遮蔽向き
#   ref_◯◯      書き出しから除外 (寸法の物差し)
# 札は組み合わせられる (col_metal_wall)。札が無ければ金属。
# 見た目と足音を同じ名前から決めているので、片方だけ変わることがない。

import bpy
import os
import math

# --- 寸法の語彙 -------------------------------------------------------------
# 高さは「その裏で何ができるか」で決める。数値そのものより関係が大事。
H_LOW = 1.0      # しゃがめば隠れる。立つと上半身が出る
H_CHEST = 1.4    # 立ったまま撃てるが胸から上が出る
H_FULL = 1.9     # 立っても完全に隠れる。視線が切れる
H_WALL = 3.2     # 壁。越えられず、向こう側が一切見えない

STEP_RISE = 0.25   # collision.ts の STEP_UP と揃えること
STEP_DEPTH = 0.7

ARENA = 40.0       # 中心から外壁までの距離 (m)。全体で 80m 四方
WALL_THICK = 1.0

objects = []


def box(name, x, y, base, sx, sy, sz):
    """
    底面を base の高さに置いた箱。位置は中心 (x, y) で指定する。

    size=1 の立方体は既に 1 辺 1m なので、倍率はそのまま辺の長さになる
    (Blender の既定は size=2 なので半分にする必要があるが、ここでは要らない)。
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, base + sz / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    objects.append(obj)
    return obj


def stairs(name, x, y, base, width, height, facing):
    """
    階段。1 段ずつ別の箱にする (AABB の判定は上面の高さしか見ないため)。

    facing は登り切る方向。'+y' なら y の大きいほうへ登る。
    """
    steps = max(1, round(height / STEP_RISE))
    for i in range(steps):
        h = STEP_RISE * (i + 1)
        offset = STEP_DEPTH * (i + 0.5)
        if facing == '+y':
            box(f'{name}_{i:02d}', x, y + offset, base, width, STEP_DEPTH, h)
        elif facing == '-y':
            box(f'{name}_{i:02d}', x, y - offset, base, width, STEP_DEPTH, h)
        elif facing == '+x':
            box(f'{name}_{i:02d}', x + offset, y, base, STEP_DEPTH, width, h)
        else:
            box(f'{name}_{i:02d}', x - offset, y, base, STEP_DEPTH, width, h)


def mirrored(fn):
    """
    y = 0 を挟んで対称に作る。
    最初の叩き台では左右対称にしておく。有利不利の議論を持ち込まずに、
    遮蔽の配置そのものが機能するかだけを見たいので。
    """
    fn(1, 'n')   # y が正の側
    fn(-1, 's')  # y が負の側


# --- 初期化 -----------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'METERS'

# --- 外周の壁 ---------------------------------------------------------------
# 見えない壁でもゲームは成立するが、壁が見えるほうが「ここが端」と分かる。
box('concrete_wall_e', ARENA, 0, 0, WALL_THICK, ARENA * 2, H_WALL)
box('concrete_wall_w', -ARENA, 0, 0, WALL_THICK, ARENA * 2, H_WALL)
box('concrete_wall_n', 0, ARENA, 0, ARENA * 2, WALL_THICK, H_WALL)
box('concrete_wall_s', 0, -ARENA, 0, ARENA * 2, WALL_THICK, H_WALL)

# --- 中央の compound ---------------------------------------------------------
# 屋根は架けられないので、壁で囲った中庭にする。
# 4 辺すべてに入口があり、どこからでも入れて、どこからでも出られる。
# 「入ったら逃げ場がない」構造は、詰める判断を賭けにしすぎる。
CX, CY = 11.0, 8.0   # 中庭の半径 (x, y)
GAP = 3.0            # 入口の幅

for sx in (1, -1):
    # 東西の壁。中央に入口を空ける
    box(f'concrete_yard_x{sx}_a', sx * CX, (CY + GAP / 2) / 2 + GAP / 4, 0,
        WALL_THICK, CY - GAP / 2, H_WALL)
    box(f'concrete_yard_x{sx}_b', sx * CX, -((CY + GAP / 2) / 2 + GAP / 4), 0,
        WALL_THICK, CY - GAP / 2, H_WALL)
for sy in (1, -1):
    box(f'concrete_yard_y{sy}_a', (CX + GAP / 2) / 2 + GAP / 4, sy * CY, 0,
        CX - GAP / 2, WALL_THICK, H_WALL)
    box(f'concrete_yard_y{sy}_b', -((CX + GAP / 2) / 2 + GAP / 4), sy * CY, 0,
        CX - GAP / 2, WALL_THICK, H_WALL)

# 中庭の中身。入っても身を隠せる場所がないと、ただの処刑場になる。
# 木箱を混ぜてあるのは、材質で足音が変わるため。同じ中庭の中でも
# どこを歩いたかが音に出て、位置を読む手掛かりが増える。
box('wood_yard_crate_a', -4.0, 2.0, 0, 3.0, 3.0, H_FULL)
box('wood_yard_crate_b', 4.5, -1.5, 0, 4.0, 2.5, H_CHEST)
box('metal_yard_crate_c', 0.0, 4.0, 0, 2.0, 2.0, H_LOW)
box('wood_yard_crate_d', -6.0, -4.5, 0, 2.5, 2.0, H_LOW)


def half(s, tag):
    # --- 高台 ---------------------------------------------------------------
    # 中庭を見下ろせる位置。見晴らしと引き換えに、登り口が 1 つしかない
    # (登っている最中は無防備、という代償を持たせる)
    PLAT_H = 2.5
    box(f'concrete_plat_{tag}', -24.0, s * 15.0, 0, 12.0, 10.0, PLAT_H)
    box(f'concrete_plat_{tag}_rail', -24.0, s * 20.2, PLAT_H, 12.0, 0.6, H_LOW)
    stairs(f'concrete_stair_{tag}', -18.5, s * 12.0, 0, 3.0, PLAT_H, '-y' if s > 0 else '+y')

    # --- 側面の通路 ---------------------------------------------------------
    # 中央を通らずに回り込める道。1 本道だと待ち伏せが強すぎる
    box(f'concrete_lane_{tag}_wall', 26.0, s * 14.0, 0, WALL_THICK, 20.0, H_WALL)
    box(f'concrete_lane_{tag}_end', 32.0, s * 24.0, 0, 13.0, WALL_THICK, H_WALL)

    # --- 中距離の遮蔽 -------------------------------------------------------
    # 高さを混ぜる。全部同じ高さだと、しゃがみと立ちの使い分けが生まれない
    box(f'wood_cover_{tag}_a', 17.0, s * 6.0, 0, 3.0, 6.0, H_FULL)
    box(f'wood_cover_{tag}_b', 8.0, s * 18.0, 0, 5.0, 2.0, H_CHEST)
    box(f'metal_cover_{tag}_c', -8.0, s * 24.0, 0, 6.0, 2.5, H_FULL)
    box(f'wood_cover_{tag}_d', 0.0, s * 14.0, 0, 3.0, 3.0, H_LOW)
    box(f'wood_cover_{tag}_e', -14.0, s * 30.0, 0, 4.0, 4.0, H_CHEST)
    box(f'metal_cover_{tag}_f', 22.0, s * 32.0, 0, 5.0, 3.0, H_LOW)
    box(f'wood_cover_{tag}_g', 30.0, s * 8.0, 0, 4.0, 5.0, H_FULL)

    # --- 湧き位置の目印 -----------------------------------------------------
    # 開けた場所に湧かせない。出た直後に撃たれると何もできない
    box(f'wood_spawn_{tag}_cover', -2.0, s * 34.0, 0, 8.0, 2.0, H_FULL)


mirrored(half)

# --- 寸法の参考 -------------------------------------------------------------
# 遮蔽の高さを目で判断するための物差し。書き出しには含めない。
refs = []
for name, height, x in (('ref_stand', 1.80, 34.0), ('ref_crouch', 0.94, 35.5), ('ref_box', 1.05, 37.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 36.0, height / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (0.25, 0.25, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    refs.append(obj)

# --- 書き出し ---------------------------------------------------------------
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
blend_path = os.path.join(root, 'tools', 'stage.blend')
glb_path = os.path.join(root, 'public', 'models', 'stage.glb')

if os.path.exists(blend_path):
    raise SystemExit(
        f'{blend_path} が既にある。\n'
        '叩き台を作り直すと今の編集が消える。消してよければ自分で消してから走らせること。\n'
        '普段の書き出しは export_stage.py のほう。'
    )

bpy.ops.wm.save_as_mainfile(filepath=blend_path)

# 物差しは選択から外す。ゲームの中に棒が 3 本立っていても邪魔なだけ。
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:
    obj.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_materials='NONE',   # 見た目はゲーム側で付ける
)

print(f'\n書き出し: {blend_path}')
print(f'書き出し: {glb_path}')
print(f'オブジェクト {len(objects)} 個 (物差し {len(refs)} 本は除外)')
