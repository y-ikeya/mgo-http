import bpy, bmesh
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
b=bpy.data.objects['Freya']; s=bpy.data.objects['Shirt']
MARGIN=0.008
ARMX=0.0
st=BVHTree.FromPolygons([s.matrix_world@v.co for v in s.data.vertices],[tuple(p.vertices) for p in s.data.polygons])
bm=bmesh.new(); bm.from_mesh(s.data); bnd=[s.matrix_world@v.co for e in bm.edges if len(e.link_faces)==1 for v in e.verts]; bm.free()
kd=KDTree(len(bnd))
for i,p in enumerate(bnd): kd.insert(p,i)
kd.balance()
mw=b.matrix_world; bi=[i for i,m in enumerate(b.data.materials) if m.name=='Body'][0]
cov=set()
for v in b.data.vertices:
    p=mw@v.co; n=(mw.to_3x3()@v.normal).normalized()
    # 体の外へ向けた線がシャツに当たる (= シャツの真下にある) 頂点だけ
    hit=st.ray_cast(p+n*0.0005, n, 0.03)
    if hit[0] is None or kd.find(p)[2]<MARGIN: continue
    if abs(p.x) < ARMX: continue
    cov.add(v.index)
kill=[p.index for p in b.data.polygons if p.material_index==bi and all(i in cov for i in p.vertices)]
bm=bmesh.new(); bm.from_mesh(b.data); bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(b.data); bm.free()
print('K culled body faces under sleeves', len(kill))
bpy.ops.wm.save_mainfile()

import os as _os, sys as _sys
_sys.stdout.flush(); _os._exit(0)
