# BB の 2F の通路の板どうしの重なりを無くす (2026-11-05 本人「床とか屋根とかの 2 重になってるところ直して」)。
#
# 通路は下絵の帯ごとの四角い板で、角で重ねて置いていた。上面が同じ高さで重なると表示がちらつき、
# 屋根 (板の外形から作る) も同じだけ重なる。**重なりが片方の板の幅いっぱいなら、その板の端を相手の縁まで
# 縮める** (角の L 字を 1 枚ずつに分ける)。軸に沿った箱だけを見る。make_bb.py からも開いている blend からも呼ぶ
SLABS = ('metal_walk_2F_',)
EPS = 0.01


def _bounds(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return [min(p[i] for p in ps) for i in range(3)], [max(p[i] for p in ps) for i in range(3)]


def _set(o, axis, old, new):
    M = o.matrix_world
    Mi = M.inverted()
    for v in o.data.vertices:
        w = M @ v.co
        if abs(w[axis] - old) < EPS:
            w[axis] = new
            v.co = Mi @ w
    o.data.update()


def overlaps(scene):
    objs = sorted([o for o in scene.objects if o.type == 'MESH' and o.name.startswith(SLABS)], key=lambda o: o.name)
    out = []
    for i, a in enumerate(objs):
        for b in objs[i + 1:]:
            (alo, ahi), (blo, bhi) = _bounds(a), _bounds(b)
            ov = [min(ahi[k], bhi[k]) - max(alo[k], blo[k]) for k in range(2)]
            if ov[0] > EPS and ov[1] > EPS:
                out.append((a, b, ov))
    return out


def trim(scene, log=print):
    done = []
    for _ in range(4):
        pairs = overlaps(scene)
        if not pairs:
            break
        for a, b, _ov in pairs:
            (alo, ahi), (blo, bhi) = _bounds(a), _bounds(b)
            # 重なりが幅いっぱいの側を縮める。両方なら細長い向きの短い方 (角の小さい片) を縮める
            for x, y, xlo, xhi, ylo, yhi in ((a, b, alo, ahi, blo, bhi), (b, a, blo, bhi, alo, ahi)):
                cut = None
                for axis in (0, 1):
                    other = 1 - axis
                    full = ylo[other] <= xlo[other] + EPS and yhi[other] >= xhi[other] - EPS
                    if not full:
                        continue
                    # x の axis 向きの端が y に入っている → その端を y の縁まで縮める
                    if ylo[axis] <= xlo[axis] + EPS < yhi[axis]:
                        cut = (axis, xlo[axis], yhi[axis])
                    elif ylo[axis] < xhi[axis] - EPS <= yhi[axis]:
                        cut = (axis, xhi[axis], ylo[axis])
                    if cut:
                        break
                if cut:
                    _set(x, *cut)
                    done.append((x.name, y.name, round(abs(cut[2] - cut[1]), 2)))
                    log(f'  重なりを切った: {x.name} を {y.name} の縁まで ({abs(cut[2] - cut[1]):.2f}m)')
                    break
    return done, overlaps(scene)
