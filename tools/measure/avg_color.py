# テクスチャの平均色を出す。「グレーっぽい」を数値で確かめるため。
import bpy, sys
for src in sys.argv[sys.argv.index('--') + 1:]:
    img = bpy.data.images.load(src)
    img.scale(64, 64)  # 平均を取るだけなので小さくしてから読む
    px = list(img.pixels)
    n = len(px) // 4
    r = sum(px[0::4]) / n; g = sum(px[1::4]) / n; b = sum(px[2::4]) / n
    # sRGB へ戻して 0-255 で表示
    to255 = lambda c: round((c ** (1/2.2)) * 255)
    mx, mn = max(r, g, b), min(r, g, b)
    sat = 0 if mx == 0 else (mx - mn) / mx
    print(f'{src.split("/")[-1]:44} RGB({to255(r):3},{to255(g):3},{to255(b):3})  彩度 {sat*100:.1f}%')
