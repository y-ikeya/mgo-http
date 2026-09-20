"""迷子になった貼り絵の場所を直す。

    $BLENDER -b --factory-startup --python tools/fix_blend_paths.py -- <.blend> [--save]

--save を付けなければ**確かめるだけ**で、何も書かない。

--- なぜ迷子になるか ---
.blend が覚えているのは**そこからの道順** (`//../../../Downloads/…`)。ファイルを
別の場所へ動かすと、同じ道順が別の場所を指す。元データを tools/ から tools/raw/
へ移したときにこれが起きて、床の板も手すりもドラム缶も一斉に落ちた。

`--pack` を足すと直した絵を**中へ詰める**。動かしても落ちなくなるが、4K の絵を
抱えると .blend が一気に太るので既定では詰めない (raft で 23MB -> 61MB)。

--- どう直すか ---
道順の**終わりの形**は変わっていないので、そこから探し直す:

  - `//raw/xxx.blend/textures/…` … 隣の .blend の中に詰めてある絵。移った先では
    `raw/` が余計なので落とす
  - `//../../../Downloads/…`     … 家の下の Downloads。深さが 1 段ずれただけ
  - それ以外                      … ファイル名で tools/raw の下を探す

探して見つからないものは**触らない**。当てずっぽうで別の絵を当てるより、
落ちたままのほうが直すときに分かる。
"""

import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
BLEND = argv[0]
SAVE = '--save' in argv
# 直した絵を中へ詰めるか。**既定は詰めない** — 4K の絵を抱え込むと .blend が
# 一気に太り (raft で 23MB -> 61MB)、保存のたびにその重さを書くことになる。
# 道順が同じ入れ物の中を指しているうちは、詰めなくても落ちない
PACK = '--pack' in argv

HOME = os.path.expanduser('~')
RAW = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(BLEND))))


def candidates(filepath: str) -> list:
    """その道順の言い分を、いま在りそうな場所へ読み替える"""
    out = []
    tail = filepath.lstrip('/')
    if tail.startswith('//'):
        tail = tail[2:]

    # 隣の .blend に詰めてある絵。raw/ の下から見ているので raw/ は要らない
    if tail.startswith('raw/'):
        out.append(os.path.join(RAW, tail[len('raw/'):]))
    # 家の下の Downloads。何段上がるかは動かすたびに変わるので、名前で拾う
    if 'Downloads/' in tail:
        out.append(os.path.join(HOME, tail[tail.index('Downloads/'):]))
    # 元データの置き場に同じ名前があれば、それ
    name = os.path.basename(tail)
    for root, _dirs, files in os.walk(RAW):
        if name in files:
            out.append(os.path.join(root, name))
    return out


bpy.ops.wm.open_mainfile(filepath=BLEND)

fixed, lost, fine = 0, [], 0
for image in bpy.data.images:
    if image.source == 'GENERATED' or not image.filepath:
        continue
    # **中に詰めてあれば落ちない。** 道順が外れていても絵は出る
    if image.packed_file or os.path.exists(bpy.path.abspath(image.filepath)):
        fine += 1
        continue
    found = next((p for p in candidates(image.filepath) if os.path.exists(p)), None)
    if not found:
        lost.append(image.name)
        continue
    image.filepath = bpy.path.relpath(found)
    image.reload()
    # --pack なら中へ詰める。動かしても落ちなくなるが、その分太る
    if PACK:
        image.pack()
    fixed += 1
    print(f'  直した {image.name:42s} -> {image.filepath}')

print(f'[paths] 元から在った {fine} / 直した {fixed} / 見つからない {len(lost)}')
for name in lost:
    print(f'  **見つからない** {name}')

if SAVE and fixed:
    bpy.ops.wm.save_mainfile(filepath=BLEND, compress=True)
    print(f'[paths] 上書きした {BLEND}')
elif not SAVE:
    print('[paths] 確かめただけ。書き込むなら --save')
