"""**空の見え方を 3D の升に焼く** (試作、2026-11-09 本人「頂点を増やす以外に影の中を暗くする方法」)。

今の焼き込み (bake_stage.py) は「空の見え方」を頂点に持たせるので、暗さを細かくしたい所は
平らな面でも頂点を割るしかなく、glb を 1.6MB 食っていた (CC)。ここでは暗さを形から切り離し、
座標の表に持たせる。画面は面の位置で表を引く (presentation/scene/world/skyGrid.ts)。

    升は 50cm。一番近い面まで NEAR 以内の升だけ持つ (表を引くのは面の位置だけなので)
    升ごとに 6 つの向き (東西南北・上・下) の半球で測る。面の向きで混ぜると、外壁は外の
        半球、床は上の半球になる (1 つの値だと、壁のすぐ外の升が壁自身に遮られて暗く出た)
    中心が壁の中で、升の中に空気がある升だけ 25cm に割って 8 つ持つ (幅 30cm の窓の凹みの中に
        升の中心が入らず、外の明るさを引いて L の字に光った)
    値は 16 段 (4 ビット)

    $BLENDER -b <stage.blend> --python tools/sky_grid.py -- <stage名>

書き出す物: public/models/stage_<名>.sky.bin

    'SKY2' | u32 見出しの長さ | 見出し (JSON) | (u32 長さ | zlib) × 3
    見出し  lo (Blender の座標、升の角) / cell / n (升の数) / levels / floor / kept (持つ升の数) / fine (細かく持つ升の数)
    1. 持つかどうかの印。1 升 1 ビット (番号 i + n0·(j + n1·k) の順に、各バイトの上のビットから)
    2. 持つ升の語 u32 × kept (番号の順)
       bit31 + 6 方向の値 (下から 4 ビットずつ、+x, -x, +y, -y, +z, -z。Blender の座標)
             + 隣の升との間が面でふさがっている印 (bit 24〜29、同じ向きの順)
       bit30 + 細かく持つ升の番号 (中心が壁の中の升。中に空気がある時だけ)
    3. 細かく持つ升の語 u32 × fine·8 (小升 8 つ、順は x·4 + y·2 + z。0 = 壁の中。語の形は 2 と同じ)
"""
import bpy
import json
import math
import os
import struct
import sys
import time
import zlib
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STAGE = argv[0] if argv else 'city'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bake_stage.py')
ns = {'__name__': 'sky_grid'}
exec(compile(open(SRC).read(), SRC, 'exec'), ns)

CELL = 0.5
FINE = CELL / 2
NEAR = 1.0
RAYS = 48
LEVELS = 16
FLOOR = ns['FLOOR']
up = Vector((0.0, 0.0, 1.0))
DIRS = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
DIR_RAYS = [ns['directions'](d, RAYS) for d in DIRS]

tree = ns['build_tree']()

# 範囲: 地面 (sand_ground) の上から見た広がり (無ければ全部の物)。高さは地面の下端から、その中の一番高い物 +1m まで
# 地面の物が無いステージ (lab) は、全部の物の外形から
ground = next((o for o in bpy.context.scene.objects if o.name.startswith('sand_ground')), None)
if ground is not None:
    gw = [ground.matrix_world @ Vector(c) for c in ground.bound_box]
else:
    gw = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects
          if o.type == 'MESH' and not o.name.startswith('ref_') for c in o.bound_box]
gx = (min(v.x for v in gw), max(v.x for v in gw))
gy = (min(v.y for v in gw), max(v.y for v in gw))
top = max(v.z for v in gw)
for o in bpy.context.scene.objects:
    if o.type != 'MESH' or o.name.startswith('ref_'):
        continue
    w = [o.matrix_world @ Vector(c) for c in o.bound_box]
    if max(v.x for v in w) < gx[0] or min(v.x for v in w) > gx[1] or max(v.y for v in w) < gy[0] or min(v.y for v in w) > gy[1]:
        continue
    top = max(top, max(v.z for v in w))
lo = Vector((gx[0], gy[0], min(v.z for v in gw)))
hi = Vector((gx[1], gy[1], min(top + 1.0, lo.z + 40.0)))
n = [int(math.ceil((hi[i] - lo[i]) / CELL)) for i in range(3)]
print(f'[sky] {STAGE}: 範囲 {[round(x, 1) for x in lo]} 〜 {[round(x, 1) for x in hi]} 升 {n}', flush=True)


def inside(c):
    """壁や床の塊の中か。6 方向のうち 4 つ以上で、最初に当たる面を裏から見る"""
    back = 0
    for d in DIRS:
        loc, nrm, _, dist = tree.ray_cast(c, d, 30.0)
        if loc is not None and nrm.dot(d) > 0:
            back += 1
    return back >= 4


def blocked(c, step):
    """隣の升 (6 方向) との間が面でふさがっているか。6 ビット (bit 24〜29、向きの順は DIRS)"""
    bits = 0
    for q, d in enumerate(DIRS):
        loc, _, _, _ = tree.ray_cast(c, d, step)
        if loc is not None:
            bits |= 1 << (24 + q)
    return bits


def measure(c):
    """6 方向の値を 24 ビットに詰める"""
    word = 0
    for q, rays in enumerate(DIR_RAYS):
        v = FLOOR + (1.0 - FLOOR) * ns['sky_from'](tree, c, rays, up)
        word |= min(LEVELS - 1, int(round(v * (LEVELS - 1)))) << (4 * q)
    return word


coarse = [0] * (n[0] * n[1] * n[2])
fine = []
t0 = time.time()
for k in range(n[2]):
    for j in range(n[1]):
        for i in range(n[0]):
            c = lo + Vector(((i + 0.5) * CELL, (j + 0.5) * CELL, (k + 0.5) * CELL))
            if tree.find_nearest(c, NEAR)[0] is None:
                continue
            idx = i + n[0] * (j + n[1] * k)
            centre_free = not inside(c)
            if centre_free:
                # 中心が空気なら粗い値で足りる (混ざっていても)
                coarse[idx] = 0x80000000 | measure(c) | blocked(c, CELL)
                continue
            # 中心が壁の中。升の中に空気があれば 25cm に割って持つ (細い窓の凹みの中など)
            subs = [c + Vector(((a - 0.5) * FINE, (b - 0.5) * FINE, (z - 0.5) * FINE))
                    for a in (0, 1) for b in (0, 1) for z in (0, 1)]
            states = [inside(p) for p in subs]
            if all(states):
                continue
            coarse[idx] = 0x40000000 | len(fine) // 8
            for p, solid in zip(subs, states):
                fine.append(0 if solid else 0x80000000 | measure(p) | blocked(p, FINE))
    print(f'[sky] {k + 1}/{n[2]} 段 細かく持つ升 {len(fine) // 8} ({time.time() - t0:.0f} 秒)', flush=True)

# 持つかどうかの印 (1 升 1 ビット、上のビットから)、持つ升の語、細かい升の語を、それぞれ縮める
mask = bytearray((len(coarse) + 7) // 8)
words = []
for idx, w in enumerate(coarse):
    if w:
        mask[idx >> 3] |= 0x80 >> (idx & 7)
        words.append(w)
parts = [zlib.compress(bytes(mask), 9),
         zlib.compress(struct.pack(f'<{len(words)}I', *words), 9),
         zlib.compress(struct.pack(f'<{len(fine)}I', *fine), 9)]
head = json.dumps({
    'lo': [round(lo.x, 4), round(lo.y, 4), round(lo.z, 4)],
    'cell': CELL,
    'n': n,
    'levels': LEVELS,
    'floor': FLOOR,
    'kept': len(words),
    'fine': len(fine) // 8,
}).encode()
out = os.path.join(ROOT, 'public', 'models', f'stage_{STAGE}.sky.bin')
with open(out, 'wb') as f:
    f.write(b'SKY2' + struct.pack('<I', len(head)) + head)
    for part in parts:
        f.write(struct.pack('<I', len(part)) + part)
kept = sum(1 for w in coarse if w)
print(f'[sky] 持つ升 {kept} 細かく持つ升 {len(fine) // 8} → {out} {os.path.getsize(out) / 1e6:.2f}MB ({time.time() - t0:.0f} 秒)', flush=True)
