# 骨格に無い髪の骨の重みを、残っている骨へ移す (書き出しの写しだけ)。FL2 → FL1、FR1/FR2 → Head
import bpy,os,sys
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE'); bones=set(b.name for b in arm.data.bones)
MOVE={'mixamorig:Hair_FL2':'mixamorig:Hair_FL1','mixamorig:Hair_FR1':'mixamorig:Head','mixamorig:Hair_FR2':'mixamorig:Head'}
for o in bpy.data.objects:
    if o.type!='MESH': continue
    names={g.index:g.name for g in o.vertex_groups}; moved=0
    for src,dst in MOVE.items():
        if src in bones or src not in o.vertex_groups: continue
        if dst not in bones: dst='mixamorig:Head'
        sg=o.vertex_groups[src]; dg=o.vertex_groups.get(dst) or o.vertex_groups.new(name=dst)
        for v in o.data.vertices:
            for g in v.groups:
                if g.group==sg.index and g.weight>0:
                    cur=next((h.weight for h in v.groups if h.group==dg.index),0.0)
                    dg.add([v.index],min(1.0,cur+g.weight),'REPLACE'); moved+=1
        o.vertex_groups.remove(sg)
    dead=[g.name for g in o.vertex_groups if g.name.startswith('mixamorig:') and g.name not in bones]
    print('H', o.name, 'moved', moved, 'dead left', dead)
bpy.ops.wm.save_mainfile(); sys.stdout.flush(); os._exit(0)
