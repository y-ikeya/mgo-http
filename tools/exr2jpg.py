# EXR を JPEG へ落とす。three.js は EXR を標準で読めず、法線や粗さに HDR の精度は要らない。
# 色空間の変換が掛からないよう Non-Color のまま保存する。
import bpy, sys
args = sys.argv[sys.argv.index('--') + 1:]
for src, dst, size in zip(args[0::3], args[1::3], args[2::3]):
    img = bpy.data.images.load(src)
    img.colorspace_settings.name = 'Non-Color'
    img.scale(int(size), int(size))
    bpy.context.scene.render.image_settings.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 92
    img.file_format = 'JPEG'
    img.filepath_raw = dst
    img.save()
    print(f'書き出し: {dst} ({size}x{size})')
