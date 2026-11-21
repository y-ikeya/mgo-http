#!/usr/bin/env bash
# pepa1404 の体 (Freya) を書き出す。**これ 1 本で public/models/soldier_freya.glb を作り直す。**
#
#     bash tools/skins/freya/build.sh                       元の .blend は ~/Downloads/Blend/Freya.blend
#     FREYA_BLEND=path/to/Freya.blend bash tools/skins/freya/build.sh
#
# 前は手順が作業用の一時置き場と skin.ts の注釈に散っていた (2026-11-20 にここへ集めた)。
# **体の正は本人が手で直す Freya.blend** (肉・骨・重み・材質・T ポーズ)。型 (動き) の正は soldier.glb と
# tools/raw/weapon_poses.blend で、ここでは soldier.glb から全部写す。
#
# 元の .blend には書かない。tools/raw/freya.blend へ写してから、その写しに手を入れる。
# **Blender で元の .blend を開いたまま走らせてよい** (保存されている版を読む)。
#
# 手順:
#   1. hairdead.py        骨格に無い髪の骨の重みを、残っている骨へ移す
#   2. shapekeys_zero.py  シェイプキー (瞬き) を 0 にする (開いた目で書き出す)
#   3. fix_units.py       骨格を宿主と同じ単位にする (Armature の scale 0.01・骨は cm)
#   4. cull.py            シャツの袖の下に隠れる体の面を消す (服から肌が抜けるのを減らす)
#   5. rebody.py          Mixamo の骨に入れ直す (--nohead --bust)
#   6. merge_all_clips    soldier.glb の型を全部写す (回転だけ)。Blender の見本の型 (tools/raw/clips/) は世界の曲がりで写し直す
#   7. fit_height --hips --sink 0.016   背丈を宿主に揃える (裸足で足裏が浮くぶん沈める)
#   8. strip_bone_moves → prune → dedup → pack
#   9. 眉のくり抜きの境を 0.2 に (書き出しは 0.5 で、毛のほとんどが抜けて眉が薄く見えた)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/tools/skins/freya"
SRC="${FREYA_BLEND:-$HOME/Downloads/Blend/Freya.blend}"
WORK="${TMPDIR:-/tmp}/mgohttp_skin_freya"
COPY="$ROOT/tools/raw/freya.blend"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
cd "$ROOT"
mkdir -p "$WORK"

[ -f "$SRC" ] || { echo "元の .blend が無い: $SRC" >&2; exit 1; }
cp "$SRC" "$COPY"

"$BLENDER" -b "$COPY" --python "$HERE/hairdead.py" 2>&1 | grep "^H" || true
"$BLENDER" -b "$COPY" --python "$HERE/shapekeys_zero.py" 2>&1 | grep "^Z" || true
"$BLENDER" -b "$COPY" --python "$HERE/fix_units.py" 2>&1 | grep "^U"
"$BLENDER" -b "$COPY" --python "$HERE/cull.py" 2>&1 | grep "^K"

# 型の元。public/models/soldier.glb を毎回ほどいて使う (古い写しを使うと、後から足した型が入らない)
bun tools/unpack_glb.js public/models/soldier.glb "$WORK/soldier_u.glb" >/dev/null
"$BLENDER" -b --factory-startup --python tools/rebody.py -- "$COPY" "$WORK/freya_base.glb" --nohead --bust 2>&1 | grep -E "胸" || true
bun tools/merge_all_clips.js "$WORK/soldier_u.glb" "$WORK/freya_base.glb" "$WORK/freya_m.glb" >/dev/null
# Blender の見本で作った型 (tools/raw/clips/、weapon_poses.blend の preview_ak_* から書き出した物) は、
# 骨ごとに世界の曲がりで写し直す (tools/retarget_world.js)。soldier.glb から局所の回りのまま写すと、
# 骨の休みの向きの差で Freya の手が見本から 6cm ずれた (2026-11-20)
for pair in rifle_relaxed_idle:smg_relaxed_idle rifle_aim:smg_aim rifle_crouch_relaxed:smg_crouch_relaxed \
            rifle_crouch_aim:smg_crouch_aim rifle_prone_relaxed:smg_prone_relaxed rifle_prone_aim:smg_prone_aim; do
  clip="${pair%%:*}"; hips="${pair##*:}"
  bun tools/retarget_world.js "$WORK/freya_m.glb" "tools/raw/clips/$clip.glb" "$WORK/rt_$clip.glb" >/dev/null
  bun tools/merge_clip.js "$WORK/freya_m.glb" "$WORK/rt_$clip.glb" "$clip" "$WORK/freya_m2.glb" --rotation-only --hips-from "$hips" >/dev/null
  mv "$WORK/freya_m2.glb" "$WORK/freya_m.glb"
done
# AK のしゃがみ走り: 体は P90 のしゃがみ走り、腕は AK のしゃがみ止まり (animation.ts の rifle)
bun tools/compose_clip.js "$WORK/freya_m.glb" rifle_crouch_run smg_crouch_run rifle_crouch_relaxed >/dev/null
bun tools/fit_height.js "$WORK/soldier_u.glb" "$WORK/freya_m.glb" --hips --sink 0.016 2>&1 | grep 合わせた
bun tools/strip_bone_moves.js "$WORK/freya_m.glb" >/dev/null
npx @gltf-transform/cli prune "$WORK/freya_m.glb" "$WORK/freya_p.glb" --keep-solid-textures >/dev/null
npx @gltf-transform/cli dedup "$WORK/freya_p.glb" "$WORK/freya_d.glb" >/dev/null
bun tools/pack_glb.js "$WORK/freya_d.glb" "$WORK/soldier_freya.glb"
cp "$WORK/soldier_freya.glb" public/models/soldier_freya.glb

python3 - <<'PY'
import json, struct
p = 'public/models/soldier_freya.glb'
b = open(p, 'rb').read()
n = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + n])
rest = b[20 + n:]
for m in j['materials']:
    if m['name'] == 'Eyebrows':
        m['alphaCutoff'] = 0.2
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
open(p, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)
print('眉のくり抜きの境 0.2')
PY
echo "書き出した: public/models/soldier_freya.glb"
