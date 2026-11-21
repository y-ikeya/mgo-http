# 骨格を宿主と同じ単位 (Armature の scale 0.01・骨は cm) にする。体の見た目の位置・大きさは変えない。
# 子の形はいったん親から外して世界の座標へ焼き、骨格の scale を焼いてから、世界の位置のまま付け直す
# (親子の付け方や子の scale によらない。2026-11-19 に帽子の scale 0.939 で子が 1/100 に縮んだ)
import bpy, os, sys
if bpy.context.object and bpy.context.object.mode != "OBJECT": bpy.ops.object.mode_set(mode="OBJECT")
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
kids=[o for o in bpy.data.objects if o.type=='MESH']
# 隠れている物は選べず、焼きが黙って効かない (2026-11-19 に骨格が隠れていて骨が m のまま残った)
for o in [arm]+kids:
    o.hide_set(False); o.hide_viewport=False; o.hide_select=False
def box(o): 
    ps=[o.matrix_world@v.co for v in o.data.vertices]; return [round(min(p[i] for p in ps),4) for i in range(3)]+[round(max(p[i] for p in ps),4) for i in range(3)]
before={o.name:box(o) for o in kids}
def apply(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in kids:
    mw=o.matrix_world.copy(); o.parent=None; o.matrix_world=mw
bpy.context.view_layer.update()
apply(kids)
s=arm.scale[0]
arm.scale=(100*s,)*3; bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active=arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
assert abs(arm.scale[0]-1)<1e-6, ('骨格の scale が焼けていない', arm.scale[:])
arm.scale=(0.01,0.01,0.01); bpy.context.view_layer.update()
for o in kids:
    o.parent=arm; o.matrix_parent_inverse=arm.matrix_world.inverted()
bpy.context.view_layer.update()
bad=[o.name for o in kids if max(abs(a-b) for a,b in zip(before[o.name],box(o)))>1e-3]
hips=(arm.matrix_world@arm.data.bones['mixamorig:Hips'].head_local)
print('U arm', arm.scale[:], 'hips', [round(x,3) for x in hips], 'moved', bad)
bpy.ops.wm.save_mainfile(); sys.stdout.flush(); os._exit(0)
