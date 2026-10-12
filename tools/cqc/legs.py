# 投げる側の足を付け直す (つま先を床に留め、足は太ももの向きへ)。Blender の中で exec する
import bpy, math
from mathutils import Vector, Quaternion, Matrix
a=bpy.data.objects['attacker']; s=bpy.context.scene
act=bpy.data.actions['cqc_throw']; a.animation_data.action=act
P='mixamorig:'; W=a.matrix_world; WQ=W.to_quaternion()
LEGS=('LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot')
def wh(n): return W@a.pose.bones[P+n].head
def wq(n): return (W@a.pose.bones[P+n].matrix).to_quaternion()
def set_world_rot(pb,q):
    m=pb.matrix.copy(); pb.matrix=Matrix.LocRotScale(m.to_translation(), WQ.inverted()@q, m.to_scale()); bpy.context.view_layer.update()
def rot_world(pb,frm,to):
    if frm.length<1e-6 or to.length<1e-6: return
    set_world_rot(pb, frm.normalized().rotation_difference(to.normalized())@(W@pb.matrix).to_quaternion())
def two_bone(side,target,q):
    up,lo,ft=[a.pose.bones[P+side+n] for n in ('UpLeg','Leg','Foot')]
    sh=wh(side+'UpLeg'); el=wh(side+'Leg'); wr=wh(side+'Foot')
    la=(el-sh).length; lb=(wr-el).length; to=target-sh
    reach=max(min(to.length,la+lb-1e-4),abs(la-lb)+1e-4); al=to.normalized()
    ref=(wr-sh).normalized(); pole=el-sh; pole-=ref*pole.dot(ref); pole-=al*pole.dot(al)
    if pole.length<1e-6: pole=Vector((0,-1,0))
    pole.normalize()
    cA=max(-1,min(1,(la*la+reach*reach-lb*lb)/(2*la*reach))); sA=math.sqrt(1-cA*cA)
    rot_world(up, el-sh, al*(la*cA)+pole*(la*sA))
    el2=wh(side+'Leg'); wr2=wh(side+'Foot'); rot_world(lo, wr2-el2, sh+al*reach-el2)
    set_world_rot(ft,q)
def weight(f, lo, hi, ramp=3):
    if f<lo-ramp or f>hi+ramp: return 0.0
    if lo<=f<=hi: return 1.0
    t=(f-(lo-ramp))/ramp if f<lo else 1-(f-hi)/ramp
    return t*t*(3-2*t)
KEEP=[1,2,3,4,5,6,7,8,9,24,32,39,46,53,60,70]
for fc in [fc for l in act.layers for st in l.strips for cb in st.channelbags for fc in cb.fcurves]:
    if not any(('"%s%s"'%(P,n)) in fc.data_path for n in LEGS): continue
    pts=fc.keyframe_points
    for i in reversed(range(len(pts))):
        if round(pts[i].co.x) not in KEEP: pts.remove(pts[i])
    fc.update()
orig={}
for f in range(1,71):
    s.frame_set(f); bpy.context.view_layer.update()
    orig[f]={pb.name: pb.matrix_basis.copy() for pb in a.pose.bones}
def apply_orig(f):
    for pb in a.pose.bones: pb.matrix_basis=orig[f][pb.name].copy()
    bpy.context.view_layer.update()
# 足首 → つま先 (指の付け根) の、足の骨から見た向きと長さ
apply_orig(1)
toe_local={}
for side in ('Left','Right'):
    toe_local[side]=wq(side+'Foot').inverted()@(wh(side+'ToeBase')-wh(side+'Foot'))
TOE_Z=0.02
lockL=Vector((0.45,-0.75,TOE_Z)); lockR1=None; lockR2=Vector((0.06,-0.98,TOE_Z))
apply_orig(1); lockR1=wh('RightToeBase').copy(); lockR1.z=TOE_Z
def yaw_only(q_leg_ref, q_foot):
    return q_foot
def foot_q_following(side):
    # 足の向き: 脚 (すね) の水平の向きに合わせて回す。床に対しては平ら
    knee=wh(side+'Leg'); ankle=wh(side+'Foot')
    shin=(ankle-knee); 
    # すねの前 = 脛の骨の前方。膝の曲がる向きを使う: 太ももの水平成分
    thigh=wh(side+'Leg')-wh(side+'UpLeg'); fwd=Vector((thigh.x,thigh.y,0))
    if fwd.length<0.05: fwd=Vector((-math.sin(0),-math.cos(0),0))
    fwd.normalize()
    cur=wq(side+'Foot'); toe_dir=cur@toe_local[side]; td=Vector((toe_dir.x,toe_dir.y,0))
    if td.length<1e-6: return cur
    turn=td.normalized().rotation_difference(fwd)
    return turn@cur
def pin(side, toe_target, w):
    q_now=wq(side+'Foot')
    q_follow=foot_q_following(side)
    q=q_now.slerp(q_follow,w)
    ankle_target=toe_target-(q@toe_local[side])
    cur_ankle=wh(side+'Foot')
    two_bone(side, cur_ankle.lerp(ankle_target,w), q)
res={}; FLOOR=0.12
for f in range(1,71):
    apply_orig(f)
    for side,lock,lo_,hi_ in (('Left',lockL,10,70),('Right',lockR1,1,20),('Right',lockR2,38,70)):
        w=weight(f,lo_,hi_)
        if w>0: pin(side,lock,w)
    if 20<f<38:
        t=(f-20)/18; t2=t*t*(3-2*t)
        p=lockR1.lerp(lockR2,t2); p.z=TOE_Z+0.15*math.sin(math.pi*t)
        pin('Right',p,1.0)
    for side in ('Left','Right'):
        p=wh(side+'Foot')
        if p.z<FLOOR-0.005: two_bone(side, Vector((p.x,p.y,FLOOR)), wq(side+'Foot'))
    res[f]={n:a.pose.bones[P+n].matrix_basis.copy() for n in LEGS}
for f in range(1,71):
    for n,m in res[f].items():
        pb=a.pose.bones[P+n]; pb.matrix_basis=m; pb.keyframe_insert('rotation_quaternion',frame=f)
rows=[]
for f in (10,24,32,39,46,53,70):
    s.frame_set(f); bpy.context.view_layer.update()
    lt=wh('LeftToeBase'); rt=wh('RightToeBase')
    th=wh('LeftLeg')-wh('LeftUpLeg'); ft=wh('LeftToeBase')-wh('LeftFoot')
    ang=math.degrees(Vector((th.x,th.y)).angle_signed(Vector((ft.x,ft.y)))) if Vector((th.x,th.y)).length>0.05 else 0
    rows.append(f"{f}: Ltoe {lt.x:.2f},{lt.y:.2f},{lt.z:.2f} Rtoe {rt.x:.2f},{rt.y:.2f},{rt.z:.2f} Lknee-foot twist {ang:.0f}")
print('\n'.join(rows))
bpy.ops.wm.save_mainfile()
