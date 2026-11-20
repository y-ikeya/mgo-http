import bpy, os, sys
for o in bpy.data.objects:
    ks=o.data.shape_keys if o.type=='MESH' else None
    if ks:
        for kb in ks.key_blocks: kb.value=0.0
        print('Z', o.name, [kb.name for kb in ks.key_blocks])
bpy.ops.wm.save_mainfile()
sys.stdout.flush(); os._exit(0)
