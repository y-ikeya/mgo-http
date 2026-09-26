# 検証場 (lab) を白紙から起こす。**動作を試すための地形。**
#
#   $BLENDER -b --factory-startup --python tools/make_lab.py
#   $BLENDER -b tools/raw/stage_lab.blend --python tools/export_stage.py
#
# 書き出すのは tools/raw/stage_lab.blend。既にあれば上書きする (叩き台なので手で
# 育てない。育てたくなったら別名にする)。
#
# 置いてある物 (座標は Blender、X 右 / Y 奥 / Z 上、地面の上面が 0.1 = GROUND_TOP):
#   段の列      上面 0.25 / 0.45 / 0.9 / 1.2 / 1.5 の箱。歩いて上がれる・跳べる・乗れる・壁、の境目
#   窓の壁      枠 0.9、鴨居 2.0、幅 2.2。跳び越え・しゃがみでくぐる
#   低い通路    天井 1.25。しゃがみで通る
#   階段        0.25 × 12 段で 3.0 まで。上に床 (deck)
#   床 (deck)   3.0 の高さ、8 × 8。縁からぶら下がれる。梯子で登り降り
#   堀          1.0 の台 2 つの間に 2m の溝。しゃがんで隠れる、跳んで出る
#   低い遮蔽    1.0 の木箱。しゃがんで隠れる
#   基地        meta_baseBlue / meta_baseRed (湧く所)
import bpy
import mathutils
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GROUND_TOP = 0.1
out = os.path.join(root, 'tools', 'raw', 'stage_lab.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def box(name, x, y, z, sx, sy, sz):
    """中心 (x, y, z)、大きさ (sx, sy, sz) の箱"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return o


def slab(name, x0, y0, x1, y1, top, thick=0.5):
    """上面が top、その下に thick の厚み"""
    return box(name, (x0 + x1) / 2, (y0 + y1) / 2, top - thick / 2, x1 - x0, y1 - y0, thick)


def empty(name, x, y, z):
    bpy.ops.object.empty_add(location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    return o


# 地面。上面 0.1 (コード側の仮の地面 y=0 と重なると面がちらつく)、厚み 2
# 札は concrete_。sand_ は Blender で絵を貼る前提で、貼らないと素の色になる
slab('concrete_ground', -30, -30, 30, 30, GROUND_TOP, 2)

# 段の列 (西)。x = -24、y を 4m ずつ
for i, h in enumerate((0.25, 0.45, 0.9, 1.2, 1.5)):
    slab(f'concrete_step_{int(h * 100):03d}', -26, -20 + i * 4, -22, -17 + i * 4, h, h)

# 窓の壁 (北西)。壁は y = 10 に沿って x -26..-14、厚み 0.24
sill_top, lintel_bottom, wall_top = 0.9, 2.0, 3.0
slab('concrete_window_sill', -21, 9.88, -18.8, 10.12, sill_top, sill_top)
box('concrete_window_lintel', -19.9, 10, (lintel_bottom + wall_top) / 2, 2.2, 0.24, wall_top - lintel_bottom)
box('concrete_window_left', -23.5, 10, wall_top / 2, 5, 0.24, wall_top)
box('concrete_window_right', -16.4, 10, wall_top / 2, 4.8, 0.24, wall_top)

# 低い通路 (北)。床から天井まで 1.3 (しゃがみ 1.25 が通る)、幅 1.6、長さ 4
box('concrete_tunnel_wall_a', -8, 12, 1.0, 4, 0.24, 2.0)
box('concrete_tunnel_wall_b', -8, 13.84, 1.0, 4, 0.24, 2.0)
box('concrete_tunnel_roof', -8, 12.92, GROUND_TOP + 1.3 + 0.12, 4, 2.08, 0.24)

# 伏せでしか通れない隙間 (北、通路の隣)。床から天井まで 0.9、幅 1.6、長さ 4。
# 中で Space を押してもしゃがみに起き上がれないことを見る
box('concrete_crawl_wall_a', -2, 12, 1.0, 4, 0.24, 2.0)
box('concrete_crawl_wall_b', -2, 13.84, 1.0, 4, 0.24, 2.0)
box('concrete_crawl_roof', -2, 12.92, GROUND_TOP + 0.9 + 0.12, 4, 2.08, 0.24)

# city の階段 (concrete_stair1、Array で組んだ段) を持ち込む。**本番の階段で坂の板を試す**。
# 低い端が +y 側、高い端が -y 側。高い端に上の床 (1 段ぶん上) を付ける
CITY_BLEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw', 'stage_city.blend')
if os.path.exists(CITY_BLEND):
    with bpy.data.libraries.load(CITY_BLEND, link=False) as (src, dst):
        dst.objects = ['concrete_stair1'] if 'concrete_stair1' in src.objects else []
    for stair in dst.objects:
        if stair is None:
            continue
        scene.collection.objects.link(stair)
        # 段は Geometry Nodes で組んである。モディファイアはそのまま (書き出しが確定させる)。
        # 外枠は確定後の形で測る — 元の箱 (6 面) で測ると段が無い
        bpy.context.view_layer.update()
        evaluated = stair.evaluated_get(bpy.context.evaluated_depsgraph_get())
        lo = [min((stair.matrix_world @ mathutils.Vector(c))[i] for c in evaluated.bound_box) for i in range(3)]
        hi = [max((stair.matrix_world @ mathutils.Vector(c))[i] for c in evaluated.bound_box) for i in range(3)]
        # 足元を地面に、真ん中を (-2, -8) に
        stair.location.x += -2 - (lo[0] + hi[0]) / 2
        stair.location.y += -8 - (lo[1] + hi[1]) / 2
        stair.location.z += GROUND_TOP - lo[2]
        depth = hi[1] - lo[1]
        height = hi[2] - lo[2]
        # 上の床。最上段より 1 段 (0.13) 上、高い端 (-y) に続ける
        slab('concrete_stair_top', -3.1, -8 - depth / 2 - 4, -0.9, -8 - depth / 2, GROUND_TOP + height + 0.13, 0.3)
        print(f'[lab] city の階段を置いた: 奥行き {depth:.2f} 高さ {height:.2f}')

# 階段 (東)。x = 4 から +x へ、0.25 × 12 段、幅 2
for i in range(12):
    h = 0.25 * (i + 1)
    slab(f'concrete_stair_{i + 1:02d}', 4 + i * 0.3, -1, 4.3 + i * 0.3, 1, h, h)

# 床 (deck)。階段の上、3.0 の高さ、8 × 8。厚み 0.3 (下はくぐれる)
slab('concrete_deck', 7.6, -4, 15.6, 4, 3.0, 0.3)
# 梯子。deck の南面に添える
box('ladder_a', 11.6, -4.05, 1.5, 0.7, 0.06, 3.0)

# 堀 (南)。上面 1.0 の台を 2 つ、間に 2m の溝 (底は地面)
slab('concrete_plateau_w', -10, -26, -2, -18, 1.0, 1.0)
slab('concrete_plateau_e', 0, -26, 8, -18, 1.0, 1.0)

# 低い遮蔽 (中央)。1.0 の木箱
box('wood_cover', 0, 0, 0.5, 1.2, 1.2, 1.0)

# 基地
empty('meta_baseBlue', -10, 0, GROUND_TOP)
empty('meta_baseRed', 12, 8, GROUND_TOP)

bpy.ops.wm.save_as_mainfile(filepath=out)
print(f'[lab] 保存した: {out}')
