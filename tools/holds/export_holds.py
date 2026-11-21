"""
weapon_poses.blend の見本から、銃の持ち方 (手から見た銃の置き場所) を書き出す。

    bash tools/holds/export_holds.sh            src/presentation/scene/arms/holds.generated.ts を書く
    bash tools/holds/export_holds.sh --check    書かずに、今の値と違えば止める

--- なぜ要るか (2026-11-20 本人「blender で定義したものとなんで同じになってないのか」) ---
前は Blender で手から見た銃の位置・向きを読み、weapon.ts へ手で写していた。その数字は「Blender の銃の
原点 = ゲームの銃の原点」を前提にしているが、見本の銃は写しごとに形が原点からずれていた (拳銃 6 つの
うち 4 つ、狙撃銃 7 つのうち 2 つ)。Blender では握って見えるのに、ゲームでは 5〜22cm ずれた。

ここでは**原点を信じない**。ゲームの銃の模型 (public/models/<銃>.glb) を読み込み、見本の銃の形と
突き合わせて「ゲームの模型の原点が、見本ではどこにあるか」を出し、そこを手から見た値にする。
最後に、出した値でゲームの模型を置き直し、見本の銃と形が重なるかを確かめる (重ならなければ止める)。

.blend は読むだけ。保存しない
"""
import bpy, sys, os, json, math
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, OUT = argv[0], argv[1]
CHECK = '--check' in argv

# 見本の集まり → (ゲームの銃, 持ち方の名前)。名前は weapon.ts の WeaponConfig の欄
SAMPLES = {
    'preview_p90': ('smg', 'standHold'),
    'preview_p90_aim': ('smg', 'aimHold'),
    'preview_p90_crouch': ('smg', 'crouchHold'),
    'preview_p90_crouch_aim': ('smg', 'crouchAimHold'),
    'preview_p90_prone': ('smg', 'proneHold'),
    'preview_p90_prone_aim': ('smg', 'proneAimHold'),
    'preview_m9_stand': ('pistol', 'standHold'),
    'preview_m9_stand_aim': ('pistol', 'aimHold'),
    'preview_m9_crouch': ('pistol', 'crouchHold'),
    'preview_m9_crouch_aim': ('pistol', 'crouchAimHold'),
    'preview_m9_prone': ('pistol', 'proneHold'),
    'preview_m9_prone_aim': ('pistol', 'proneAimHold'),
    'preview_sniper_stand': ('sniper', 'standHold'),
    'preview_sniper_stand_aim': ('sniper', 'aimHold'),
    'preview_sniper_crouch': ('sniper', 'crouchHold'),
    'preview_sniper_crouch_aim': ('sniper', 'crouchAimHold'),
    'preview_sniper_prone': ('sniper', 'proneHold'),
    'preview_sniper_prone_aim': ('sniper', 'proneAimHold'),
    # AK (2026-11-20 本人「weapon に ak の prone, chrouch, stand の aim/relax をかいて、キャラは freya で」)
    'preview_ak_stand': ('rifle', 'standHold'),
    'preview_ak_stand_aim': ('rifle', 'aimHold'),
    'preview_ak_crouch': ('rifle', 'crouchHold'),
    'preview_ak_crouch_aim': ('rifle', 'crouchAimHold'),
    'preview_ak_prone': ('rifle', 'proneHold'),
    'preview_ak_prone_aim': ('rifle', 'proneAimHold'),
    # M4。体の型は AK と共有 (見本の骨格が AK と同じ型を引いている)、銃だけ M4
    'preview_m4_stand': ('m4', 'standHold'),
    'preview_m4_stand_aim': ('m4', 'aimHold'),
    'preview_m4_crouch': ('m4', 'crouchHold'),
    'preview_m4_crouch_aim': ('m4', 'crouchAimHold'),
    'preview_m4_prone': ('m4', 'proneHold'),
    'preview_m4_prone_aim': ('m4', 'proneAimHold'),
}
LEFT_KEYS = {'aimHold': 'leftHand', 'crouchAimHold': 'crouchLeftHand', 'proneAimHold': 'proneLeftHand'}
MODELS = {'smg': 'smg.glb', 'pistol': 'm9.glb', 'sniper': 'sniper.glb', 'rifle': 'rifle.glb', 'm4': 'm4.glb'}
# ゲームの体の手の骨の大きさ (世界)。名無し・Freya の glb はこれ (骨は cm、Armature の縮め込み)。
# 見本の骨格は体ごとに単位が違う (名無しは cm の骨 × 0.0085、Freya は m の骨) ので、手の向きと位置だけを取り、
# 大きさはこれに揃えて値を出す。揃えないと Freya の見本から出した値がゲームで 117 倍ずれる
GAME_HAND_SCALE = 0.008517144247889519
# 形が重なったとみなす誤差 (m)
TOLERANCE = 0.003

# glTF (Y 上) → Blender (Z 上) の向きの差。ゲームの値は Blender の値にこれを右から掛けた物
TO_GAME = Quaternion((math.sqrt(0.5), math.sqrt(0.5), 0, 0))


def model_points(path):
    """ゲームの模型の頂点 (模型の原点から、Blender の向き)。読み込んで測り、消す"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    added = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    pts = []
    for o in added:
        if o.type == 'MESH':
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    for o in added:
        bpy.data.objects.remove(o, do_unlink=True)
    return pts


def box(pts):
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


bpy.context.view_layer.update()
models = {k: model_points(os.path.join(ROOT, 'public/models', f)) for k, f in MODELS.items()}

holds, problems = {}, []
for coll_name, (gun, key) in SAMPLES.items():
    coll = bpy.data.collections.get(coll_name)
    if not coll:
        problems.append(f'{coll_name}: 見本が無い')
        continue
    arm = next((o for o in coll.all_objects if o.type == 'ARMATURE'), None)
    guns = [o for o in coll.all_objects if o.type == 'MESH' and o.parent_type == 'BONE']
    if not arm or len(guns) != 1:
        problems.append(f'{coll_name}: 骨格か、手に付いた銃が 1 つでない ({[g.name for g in guns]})')
        continue
    obj = guns[0]
    hand_raw = arm.matrix_world @ arm.pose.bones[obj.parent_bone].matrix
    hl, hr, _ = hand_raw.decompose()
    hand = Matrix.LocRotScale(hl, hr, Vector((GAME_HAND_SCALE,) * 3))
    rel = hand.inverted() @ obj.matrix_world
    # 見本の形 (物の局所) と模型の形 (模型の局所) の箱を比べる。大きさが同じなら、ずれは平行移動だけ
    local = [v.co.copy() for v in obj.data.vertices]
    (lo, hi), (mlo, mhi) = box(local), box(models[gun])
    size_gap = max(abs((hi - lo)[i] - (mhi - mlo)[i]) for i in range(3))
    sx = rel.to_scale()[0]
    if size_gap * sx * hand.to_scale()[0] > TOLERANCE:
        problems.append(f'{coll_name}: 見本の銃 ({obj.name}) の形がゲームの模型と違う (大きさの差 {size_gap:.4f})')
        continue
    shift = lo - mlo
    at = rel @ Matrix.Translation(shift)
    loc, rot, scl = at.decompose()
    q = rot @ TO_GAME
    # 確かめる: 出した値で模型を置き、見本の銃と頂点の箱が重なるか (世界で)
    placed = hand @ Matrix.LocRotScale(loc, rot, scl)
    a_lo, a_hi = box([placed @ p for p in models[gun]])
    b_lo, b_hi = box([obj.matrix_world @ v for v in local])
    err = max(max(abs(a_lo[i] - b_lo[i]), abs(a_hi[i] - b_hi[i])) for i in range(3))
    if err > TOLERANCE:
        problems.append(f'{coll_name}: 置き直した模型が見本と {err * 100:.1f}cm ずれる')
        continue
    # 構えの見本は、左手が銃のどこを握っているかも出す (銃の空間、ゲームの向き)。体ごとに腕の長さが違うので、
    # 型の回転だけでは左手が銃に着かない (Freya で 4cm 外れた)。ゲームは左手をここへ運ぶ (armIk.ts の LeftArmFollow)
    left_key = LEFT_KEYS.get(key)
    if left_key:
        lb = arm.pose.bones.get('mixamorig:LeftHand')
        lw = arm.matrix_world @ lb.matrix
        in_model = placed.inverted() @ lw   # 模型の空間 (Blender の向き)
        to_game = TO_GAME.to_matrix().to_4x4()
        g = to_game.inverted() @ in_model
        lloc = g.to_translation()
        lq = (TO_GAME.inverted() @ rot.inverted() @ hand.to_quaternion().inverted() @ lw.to_quaternion())
        holds.setdefault(gun, {})[left_key] = {
            'position': [round(x, 4) for x in lloc],
            'quaternion': [round(lq.x, 5), round(lq.y, 5), round(lq.z, 5), round(lq.w, 5)],
            'from': coll_name,
            'left': True,
        }
    holds.setdefault(gun, {})[key] = {
        'position': [round(x, 4) for x in loc],
        'quaternion': [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)],
        'scale': round(scl[0], 2),
        'from': coll_name,
        'originShiftCm': round(shift.length * sx * hand.to_scale()[0] * 100, 1),
        'errorMm': round(err * 1000, 2),
    }

for p in problems:
    print('HOLD! ' + p)
for gun, table in holds.items():
    for key, h in table.items():
        if h.get('left'):
            print(f"HOLD {gun}.{key} ← {h['from']}: 左手 (銃の空間) {h['position']}")
        else:
            print(f"HOLD {gun}.{key} ← {h['from']}: 原点のずれ {h['originShiftCm']}cm, 置き直しの誤差 {h['errorMm']}mm")

lines = [
    '// **書き出した物。手で直さない。** tools/holds/export_holds.sh が tools/raw/weapon_poses.blend の見本から作る',
    '// (銃の持ち方 = 右手の骨から見たゲームの銃の模型の置き場所。単位は骨の空間)。直すのは Blender の見本',
    'export const HOLDS = {',
]
for gun in sorted(holds):
    lines.append(f'  {gun}: {{')
    for key in sorted(holds[gun]):
        h = holds[gun][key]
        lines.append(f"    // {h['from']}")
        if h.get('left'):
            lines.append(f"    {key}: {{ position: {json.dumps(h['position'])}, quaternion: {json.dumps(h['quaternion'])} }},")
        else:
            lines.append(f"    {key}: {{ position: {json.dumps(h['position'])}, quaternion: {json.dumps(h['quaternion'])}, scale: {h['scale']} }},")
    lines.append('  },')
lines.append('} as const')
text = '\n'.join(lines) + '\n'

if CHECK:
    now = open(OUT).read() if os.path.exists(OUT) else ''
    if now != text:
        print('HOLD! 書き出した値と違う (weapon_poses.blend が変わった)。export_holds.sh を回す')
        problems.append('stale')
elif not problems:
    open(OUT, 'w').write(text)
    print('HOLD 書いた ' + OUT)
sys.exit(1 if problems else 0)
