# diffuse から色味を抜いてグレーにする。
#
# マテリアル側では色を「掛ける」ことしかできず、彩度は下げられない。
# 画像そのものを変換する必要がある。
#
# 輝度は線形空間で計算する (Blender が保持する画素は線形)。
# sRGB のまま平均すると暗部が持ち上がって、のっぺりしたグレーになる。
import bpy, sys, numpy as np
src, dst, size, amount = sys.argv[-4], sys.argv[-3], int(sys.argv[-2]), float(sys.argv[-1])
img = bpy.data.images.load(src)
img.scale(size, size)
px = np.empty(len(img.pixels), dtype=np.float32)
img.pixels.foreach_get(px)
rgba = px.reshape(-1, 4)
lum = rgba[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
rgba[:, :3] += (lum[:, None] - rgba[:, :3]) * amount
img.pixels.foreach_set(rgba.reshape(-1))
bpy.context.scene.render.image_settings.file_format = 'JPEG'
bpy.context.scene.render.image_settings.quality = 88
img.file_format = 'JPEG'
img.filepath_raw = dst
img.save()
print(f'書き出し: {dst} ({size}x{size}, 彩度除去 {amount*100:.0f}%)')
