# OBJ の頂点から寸法と向きを測る。銃身がどの軸か、どちら側が銃口かを判断する。
import sys
verts = []
for line in open(sys.argv[1], errors='ignore'):
    if line.startswith('v '):
        p = line.split()
        verts.append((float(p[1]), float(p[2]), float(p[3])))
print(f'頂点 {len(verts)}')
mins = [min(v[i] for v in verts) for i in range(3)]
maxs = [max(v[i] for v in verts) for i in range(3)]
size = [maxs[i] - mins[i] for i in range(3)]
for i, ax in enumerate('XYZ'):
    print(f'  {ax}: {mins[i]:8.2f} .. {maxs[i]:8.2f}   長さ {size[i]:7.2f}')
long_axis = size.index(max(size))
print(f'\n最長軸 = {"XYZ"[long_axis]} (銃身の向き)')

# 両端の断面の太さを測る。銃口側は細く、銃床側は太い
other = [i for i in range(3) if i != long_axis]
lo, hi = mins[long_axis], maxs[long_axis]
span = hi - lo
def girth(a, b):
    sel = [v for v in verts if a <= v[long_axis] <= b]
    if not sel: return 0
    return sum(max(v[i] for v in sel) - min(v[i] for v in sel) for i in other)
low_end = girth(lo, lo + span * 0.12)
high_end = girth(hi - span * 0.12, hi)
print(f'  端の太さ: 小さい側 {low_end:.2f} / 大きい側 {high_end:.2f}')
print(f'  → 銃口は {"最小側" if low_end < high_end else "最大側"}')
