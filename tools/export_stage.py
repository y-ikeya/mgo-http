# stage.blend から stage.glb を書き出す。
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b tools/stage.blend --python tools/export_stage.py
#
# Blender の GUI から File → Export を辿るのと同じことを、コマンド 1 本でやる。
# 書き出しの設定 (選択物だけ / マテリアルなし) を毎回手で合わせずに済むので、
# 「書き出したつもりで設定が違っていた」という取り違えが起きない。
#
# ref_ で始まるオブジェクトは寸法の物差しなので除外する。
#
# 書き出す前に、当たり判定が扱えない形になっていないかを調べる。Blender の中では
# 何も問題なく見えるのに、ゲームに入れて初めて壊れているのが分かる、を減らす。

import bpy
import os
import math
import json

# 物差しの接頭辞。ゲームには持ち込まない
REF_PREFIX = 'ref_'

# 名前に付けられる札。これ以外の接頭辞は打ち間違いの可能性が高い
KNOWN_TAGS = ('col_', 'vis_', 'metal_', 'concrete_', 'wood_', 'ref_')

# 面が何を止めるか。既定は全部止めて、名前で個別に外す。
# (src/sim/flags.ts と同じ規則。MGO2 が面ごとのビットで持っていたのを借りている)
FLAG_WORDS = ('nodraw', 'noplayer', 'nobullet', 'noeye', 'nocamera')


def flags_of(name):
    flags = {'draw': True, 'player': True, 'bullet': True, 'eye': True, 'camera': True}
    # 旧: 判定だけ (見えない)。見えない物が視線を止めるのはおかしいので eye を外す
    if 'col_' in name:
        flags['draw'] = False
        flags['eye'] = False
    # 旧: 描画だけ。飾りなので人も弾もカメラも通す
    if 'vis_' in name:
        flags['player'] = False
        flags['bullet'] = False
        flags['camera'] = False
    for word in FLAG_WORDS:
        if word in name:
            flags[word[2:]] = False
    return flags


# 体の高さ (m)。src/game/player.ts の PLAYER_HEIGHT と揃える。
# くぐれる隙間かどうかの判断に使う
PLAYER_HEIGHT = 1.8

# 足を乗せられる段差 (m)。src/sim/collision.ts の STEP_UP
STEP_UP = 0.25


def check(objects):
    """
    当たり判定の前提を満たしているか調べる。

    判定は XZ 平面の AABB なので、回した箱は回す前の箱として扱われる。
    Blender の中では斜めの壁に見えていても、ゲームでは軸に沿った箱になる。
    この食い違いは実際に歩くまで気づけないので、書き出す前に言う。
    """
    problems = []
    for obj in objects:
        # 浮いているが、下をくぐれない高さ。
        #
        # **見た目と通れるかが食い違う。** 下が空いて見えるのに体が入らないので、
        # 「なぜかここだけ通れない」という形で出る。乗るための台なら段差
        # (STEP_UP) 以下に、くぐらせるなら体の高さ以上に離す。
        bottom = min((obj.matrix_world @ v.co).z for v in obj.data.vertices) if obj.data.vertices else 0
        if STEP_UP < bottom < PLAYER_HEIGHT:
            problems.append(
                f'{obj.name}: 下面が {bottom:.2f}m に浮いている '
                f'(隙間が体の高さ {PLAYER_HEIGHT}m に足りず、くぐれない)'
            )

        # 回転。90 度の倍数なら AABB として破綻しない
        for axis, angle in zip('XYZ', obj.rotation_euler):
            degrees = math.degrees(angle) % 90
            if min(degrees, 90 - degrees) > 0.5:
                problems.append(
                    f'{obj.name}: {axis} 軸に {math.degrees(angle):.1f}° 回っている '
                    f'(判定は回す前の箱になる)'
                )
                break

        # 潰れた箱。判定が消えるか、面が裏返る
        if min(obj.dimensions) < 0.01:
            problems.append(f'{obj.name}: 厚みが無い ({tuple(round(d, 3) for d in obj.dimensions)})')

        # 札の打ち間違い。metall_ のような名前は既定の材質になって静かにずれる
        head = obj.name.split('_')[0] + '_'
        if '_' in obj.name and head not in KNOWN_TAGS and not obj.name[0].isdigit():
            known = any(obj.name.startswith(tag) for tag in KNOWN_TAGS)
            if not known:
                problems.append(f'{obj.name}: 知らない札 "{head}" (材質は既定になる)')

    return problems

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
glb_path = os.path.join(root, 'public', 'models', 'stage.glb')

bpy.ops.object.select_all(action='DESELECT')

exported = []
skipped = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    if obj.name.startswith(REF_PREFIX):
        skipped.append(obj.name)
        continue
    obj.select_set(True)
    exported.append(obj.name)

if not exported:
    raise SystemExit('書き出すメッシュが無い')

problems = check([o for o in bpy.context.scene.objects if o.select_get()])
if problems:
    print('\n--- 直したほうがよい点 ---')
    for problem in problems:
        print(f'  {problem}')
    print('')

# サーバーにも同じ形を渡す。
#
# サーバーは「見えている相手だけ配る」ために遮蔽を判定する必要があるが、
# glb を読むには glTF の解析が要る。判定に使うのは箱の位置と寸法だけなので、
# それだけを JSON に落とす。glb と同時に書くので、片方だけ古いことが起きない。
#
# Blender は Z が上、glTF は Y が上。ここで揃えておく。
import mathutils


def to_gltf(v):
    """Blender (Z が上) の座標を glTF (Y が上) へ。"""
    return (v.x, v.z, -v.y)


def gltf_bounds(obj):
    pts = [to_gltf(obj.matrix_world @ mathutils.Vector(c)) for c in obj.bound_box]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def top_plane(obj, lo, hi):
    """
    上面の傾きを測る。

    判定は「XZ の四角 + 上面の高さ」しか持てないので、平らな上面しか表せなかった。
    高さを 1 つの数ではなく**平面**にすれば、同じ形のまま坂が置ける。
    箱は傾き 0 の平面なので、これまでの形はそのまま通る。

    上を向いた面の頂点に平面を当てはめる。当てはまらない形 (球や凸凹) は
    平らな蓋として扱う — 表せないものを無理に近似すると、見た目と判定が食い違う。
    """
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()

    flat = {'h': round(hi[1], 4), 'dx': 0.0, 'dz': 0.0}

    # 上を向いた面を全部混ぜてはいけない。傾いた板は、広い面も細い側面も
    # 上を向くので、両方の頂点をまとめると 1 枚の平面に乗らなくなる。
    # 「歩く面」= 上から見た面積が最大の面を選び、それと同じ向きの面だけを使う。
    faces = []
    for poly in obj.data.polygons:
        n = (nm @ poly.normal).normalized()
        if n.z < 0.3:            # 上を向いていない面は上面ではない
            continue
        faces.append((poly.area * n.z, n, poly))
    if not faces:
        return flat

    _, main, _ = max(faces, key=lambda f: f[0])

    pts = []
    for _, n, poly in faces:
        if n.dot(main) < 0.996:   # 5 度以上ずれた面は別の面
            continue
        for i in poly.vertices:
            pts.append(to_gltf(mw @ obj.data.vertices[i].co))

    if len(pts) < 3:
        return flat

    # 最小二乗で y = A + B*x + C*z を解く (3x3 の正規方程式)
    n = len(pts)
    sx = sum(p[0] for p in pts)
    sz = sum(p[2] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts)
    szz = sum(p[2] * p[2] for p in pts)
    sxz = sum(p[0] * p[2] for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    szy = sum(p[2] * p[1] for p in pts)

    m = [[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]]
    rhs = [sy, sxy, szy]

    # ガウスの消去法。退化していたら平らとして返す
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-9:
            return flat
        m[col], m[pivot] = m[pivot], m[col]
        rhs[col], rhs[pivot] = rhs[pivot], rhs[col]
        for r in range(3):
            if r == col:
                continue
            f = m[r][col] / m[col][col]
            for c in range(col, 3):
                m[r][c] -= f * m[col][c]
            rhs[r] -= f * rhs[col]
    a, b, c = (rhs[i] / m[i][i] for i in range(3))

    # 選んだ面が本当に平らか
    worst = max(abs(p[1] - (a + b * p[0] + c * p[2])) for p in pts)
    if worst > 0.05:
        return flat

    # その面より上に飛び出している所が無いか。あれば「歩く面」ではない
    for v in obj.data.vertices:
        g = to_gltf(mw @ v.co)
        if g[1] - (a + b * g[0] + c * g[2]) > 0.05:
            return flat

    if abs(b) < 0.01 and abs(c) < 0.01:
        return flat

    return {
        'h': round(a + b * lo[0] + c * lo[2], 4),   # min の角における高さ
        'dx': round(b, 5),
        'dz': round(c, 5),
    }


boxes = []
slopes = 0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or obj.name.startswith(REF_PREFIX):
        continue
    lo, hi = gltf_bounds(obj)
    top = top_plane(obj, lo, hi)
    if top['dx'] or top['dz']:
        slopes += 1
    boxes.append({
        'name': obj.name,
        'min': [round(v, 3) for v in lo],
        'max': [round(v, 3) for v in hi],
        'top': top,
        'flags': flags_of(obj.name),
    })

json_path = os.path.join(root, 'public', 'models', 'stage.json')
with open(json_path, 'w') as f:
    json.dump({'boxes': boxes}, f, ensure_ascii=False, indent=0)

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,      # モディファイアを確定させてから出す
    export_materials='NONE',  # 見た目はゲーム側で付ける
)

# 材質の内訳も出す。札の付け忘れは数を見ると気づける
counts = {}
for name in exported:
    tag = next((t for t in ('metal_', 'concrete_', 'wood_') if t in name), '(既定=金属)')
    counts[tag] = counts.get(tag, 0) + 1

print(f'\n書き出し: {glb_path}')
print(f'          {json_path} (箱 {len(boxes)} 個 / うち坂 {slopes} 個)')
print(f'メッシュ {len(exported)} 個' + (f' / 物差し {len(skipped)} 個は除外' if skipped else ''))
print('材質: ' + ' / '.join(f'{k} {v}' for k, v in sorted(counts.items())))

# 属性の内訳。既定から外れている面だけ挙げる (全部止める面は数えるだけ)
special = [b for b in boxes if not all(b['flags'].values())]
print(f'属性: 全部止める {len(boxes) - len(special)} 個' +
      (f' / 個別指定 {len(special)} 個' if special else ''))
for b in special:
    off = [k for k, v in b['flags'].items() if not v]
    print(f"  {b['name']}: {' '.join(off)} を通す")
