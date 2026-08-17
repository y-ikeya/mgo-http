"""
Mixamo のキャラから頭だけ取って、いまの兵士の体に移植する。**試作**。

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/graft-head.py

--- なぜ Blender が要るか ---
soldier.glb (Ch35) はメッシュが 1 枚に焼かれていて、頭が胴と地続きになっている。
部位ごとの差し替えができないので、頂点グループ (mixamorig:Head の重み) を見て
切り出すしかない。提供側 (Mixamo のキャラ) も同じ。

--- 詰まった所 ---
1. 親を付け替えるだけでは頭が乗らなかった。提供側は 90 度回った骨にぶら下がって
   いて空間が揃わない。**join でホストのメッシュに統合する** と Blender が
   世界座標を経由して変換してくれる。頂点グループは名前で統合される。
2. 骨の位置は 2mm しか違わないが、頭の骨は 25mm 高い。その差だけ下げる。
3. Mixamo の FBX は 4K の PNG を抱えてくる。そのままだと 59MB になるので、
   1024 に落として、髪以外は JPEG にする (髪は透過が要る)。
"""

import bpy, bmesh, math
from mathutils import Vector

SOLDIER='/Users/yuma/workspace/mgo2http/public/models/soldier.glb'
DONOR='/Users/yuma/Downloads/Dying.fbx'
OUT='/Users/yuma/workspace/mgo2http/public/models/soldier_pepa.glb'
# 骨の名前は接頭辞が揃わない。Mixamo は書き出しのたびに番号を振るので、
# 宿主が mixamorig: で提供側が mixamorig7: ということが起きる。**決め打ちにしない**
BONE='Head'
def prefix_of(arm):
    for b in arm.data.bones:
        if b.name.endswith(':Hips'): return b.name.split(':')[0]
    raise SystemExit('Hips が見つからない')
THRESH=0.5

bpy.ops.wm.read_factory_settings(use_empty=True)
# --- 何よりも先に fps を合わせる ---
#
# **Blender の既定は 24fps。**読み込むときの fps でクリップがフレームに刻まれ、
# 書き出すときの fps で秒に戻る。**その 2 つが違うと尺が変わる。**
#
# 最初は書き出しの直前に立てていて、まるで効かなかった —
# 24fps で読み込んだ時点で throw は 56 フレームになっていて、それを 30 で割ると
# 1.87 秒 (元は 2.33 秒)。48 本すべてが 0.8 倍 = 全モーションが 25% 速い。
#
# 尺が変わると、クリップ内の絶対時刻で決め打ちしている所が全部ずれる。実際
# THROW_HOLD_AT (1.5 秒で振りかぶりを止める) が振り切ったあとを指すようになり、
# 「押しっぱなしなのに手を振り下ろす」になった。
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1

bpy.ops.import_scene.gltf(filepath=SOLDIER)
host_arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
host_arm.name='Host'
host_mesh=next(o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('Ch35'))
HOSTP=prefix_of(host_arm); HEAD=f'{HOSTP}:{BONE}'
print(f'宿主の骨は {HOSTP}:')
clips_before=len(bpy.data.actions)
# 提供側の画像を見分けるための控え。FBX の画像は 'file1' のような名前で来るので、
# 名前では判別できない。**あとから増えた物が提供側**、という数え方にする
host_images={im.name for im in bpy.data.images}
for o in list(bpy.data.objects):
    if o.type=='MESH' and o is not host_mesh:
        print('捨てる:',o.name); bpy.data.objects.remove(o,do_unlink=True)

def verts_of(ob,group,thresh):
    """その頂点グループの重みが thresh を超える頂点の index"""
    gi=ob.vertex_groups[group].index
    out=set()
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group==gi and g.weight>thresh: out.add(v.index); break
    return out

def select(ob, idx):
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in ob.data.vertices: v.select = v.index in idx
    for e in ob.data.edges: e.select=False
    for p in ob.data.polygons: p.select=False

# --- 1. 元の頭を落とす ---
bpy.context.view_layer.objects.active=host_mesh
head_idx=verts_of(host_mesh,HEAD,THRESH)
print(f'Ch35 の頭 {len(head_idx)} 頂点 / 全 {len(host_mesh.data.vertices)}')
select(host_mesh,head_idx)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='VERT')
bpy.ops.mesh.delete(type='VERT'); bpy.ops.object.mode_set(mode='OBJECT')
print('落としたあと', len(host_mesh.data.vertices))

# --- 2. 提供側を読む ---
bpy.ops.import_scene.fbx(filepath=DONOR)
donor_arm=next(o for o in bpy.data.objects if o.type=='ARMATURE' and o is not host_arm)
# **キャラ番号は決め打ちにしない。** Mixamo は Ch23 / Ch33 … と番号で来るので、
# 別のキャラに乗り換えるたびに名前を書き換えることになる。入ってきた物から拾う
donor_names=[o.name for o in bpy.data.objects
             if o.type=='MESH' and o.name.startswith('Ch') and o is not host_mesh]
P=sorted({n.split('_')[0] for n in donor_names})[0]
print(f'提供側は {P} ({len(donor_names)} メッシュ: {", ".join(sorted(donor_names))})')
DONORP=prefix_of(donor_arm); DHEAD=f'{DONORP}:{BONE}'
print(f'提供側の骨は {DONORP}:')
body=bpy.data.objects[f'{P}_Body']; hair=bpy.data.objects[f'{P}_Hair']
lash=bpy.data.objects.get(f'{P}_Eyelashes')

# 体から頭だけ切り出す
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active=body
d_head=verts_of(body,DHEAD,THRESH)
print(f'{P} の頭 {len(d_head)} 頂点 / 全 {len(body.data.vertices)}')
select(body,d_head)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='VERT')
bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
new_head=[o for o in bpy.data.objects if o.name.startswith(f'{P}_Body.')][0]
new_head.name=f'{P}_HeadOnly'
bpy.data.objects.remove(body,do_unlink=True)
for o in list(bpy.data.objects):
    if o.type=='MESH' and o not in (host_mesh,new_head,hair,lash):
        bpy.data.objects.remove(o,do_unlink=True)

# --- 3. 高さを合わせて、ホストのメッシュに統合する ---
#
# 親を付け替えるだけでは駄目だった。提供側は 90 度回った骨にぶら下がっていて、
# 空間が揃わない。join なら Blender が世界座標を経由して変換してくれる。
# 頂点グループは名前で統合されるので、mixamorig:Head の重みはそのまま効く。
# 骨の「位置」は 2mm しか違わないのに、頭が 90 度倒れて乗った。
# 骨の**軸の取り方**が違うため — glTF の読み込みは節点の軸をそのまま持つが、
# FBX の読み込みは別の向きを当てる。骨に張り付いた頂点は逆バインド行列を
# 通って動くので、軸が違うとその回転ぶんだけ捻れる。
#
# 位置だけ合わせても駄目で、**同じ骨のレスト行列どうしで橋を架ける**必要がある。
H = host_arm.matrix_world  @ host_arm.data.bones[HEAD].matrix_local
D = donor_arm.matrix_world @ donor_arm.data.bones[DHEAD].matrix_local
M = H @ D.inverted()
print('橋渡しの行列 (移動 mm):', tuple(round(v*1000,1) for v in M.translation))
print('  回転 (度):', tuple(round(math.degrees(v),1) for v in M.to_euler()))

def zrange(o):
    zs=[(o.matrix_world @ Vector(c)).z for c in o.bound_box]
    return min(zs), max(zs)

grafts=[o for o in (new_head,hair,lash) if o]
bpy.ops.object.select_all(action='DESELECT')
for o in grafts: o.select_set(True)
bpy.context.view_layer.objects.active=grafts[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
for o in grafts:
    for m in list(o.modifiers):
        if m.type=='ARMATURE': o.modifiers.remove(m)
    o.matrix_world = M @ o.matrix_world
    lo,hi = zrange(o); print(f'  移植 {o.name:18} 世界 z {lo:.3f}..{hi:.3f}')
lo,hi = zrange(host_mesh); print(f'  宿主 {host_mesh.name:18} 世界 z {lo:.3f}..{hi:.3f}')
print(f'  頭の骨            世界 z {(host_arm.matrix_world @ host_arm.data.bones[HEAD].head_local).z:.3f}')

donor_action=donor_arm.animation_data.action if donor_arm.animation_data else None
bpy.data.objects.remove(donor_arm,do_unlink=True)
if donor_action: bpy.data.actions.remove(donor_action)

# **UV の名前を揃えてから統合する。**
#
# join は UV レイヤーを名前で繋ぐ。名前が違うと別のレイヤーとして並ぶので、
# 宿主の UV が TEXCOORD_0、移植側の UV が TEXCOORD_1 に入る。マテリアルは
# TEXCOORD_0 を見るため、移植側はテクスチャの 1 点だけを引くことになる —
# 髪はそこが透明で全部抜け (つるっぱげ)、顔は 1 色に潰れる (のっぺらぼう)。
# 中身は全部正しいのに描かれない、という形で出るので気づきにくい。
# **頂点グループの名前も宿主に揃える。** join は名前で繋ぐので、
# mixamorig7: のままだと宿主の骨に一本も繋がらず、頭が原点へ潰れる
if DONORP != HOSTP:
    for o in grafts:
        renamed=0
        for g in o.vertex_groups:
            if g.name.startswith(f'{DONORP}:'):
                g.name = f'{HOSTP}:' + g.name.split(':', 1)[1]; renamed+=1
        print(f'  骨の名前 {o.name}: {renamed} 個を {DONORP}: -> {HOSTP}: へ')

uv_name=host_mesh.data.uv_layers[0].name
for o in grafts:
    for layer in o.data.uv_layers:
        if layer.active_render:
            if layer.name != uv_name:
                print(f'  UV {o.name}: {layer.name!r} -> {uv_name!r}')
                layer.name=uv_name
            break

bpy.ops.object.select_all(action='DESELECT')
for o in grafts: o.select_set(True)
host_mesh.select_set(True)
bpy.context.view_layer.objects.active=host_mesh
bpy.ops.object.join()
print('統合後', len(host_mesh.data.vertices), '頂点 / マテリアル', [m.name for m in host_mesh.data.materials])
print('動き', clips_before, '->', len(bpy.data.actions))

# --- 4. テクスチャを削る ---
#
# Mixamo の FBX は 4K の PNG を抱えてくる。そのままだと 59MB で、
# 元の soldier.glb 7.1MB の 8 倍 (提供側の 4 枚だけで 53.7MB)。
# 顔と髪しか使っていないので、この解像度は要らない。
#
# 髪は PNG のまま — 透過が要る (alphaMode BLEND)。残りは JPEG にする。
SIDE=1024
hair_images=set()
hair_mat=bpy.data.materials.get(f'{P}_hair')
if hair_mat and hair_mat.use_nodes:
    for n in hair_mat.node_tree.nodes:
        if n.type=='TEX_IMAGE' and n.image: hair_images.add(n.image.name)

for im in bpy.data.images:
    if im.name in host_images: continue     # 宿主の分は触らない (既に小さい)
    before=tuple(im.size)
    if max(im.size)>SIDE: im.scale(SIDE,SIDE)
    if im.name not in hair_images: im.file_format='JPEG'
    print(f'  テクスチャ {im.name:12} {before[0]}x{before[1]} -> {im.size[0]}x{im.size[1]} {im.file_format}'
          + ('  (髪: 透過を残す)' if im.name in hair_images else ''))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_apply=False,
                          export_image_format='AUTO', export_jpeg_quality=85)
print('書き出した', OUT)

# --- 5. 髪を「抜き」にする ---
#
# 書き出したままだと髪が alphaMode=BLEND になる。中身 (頂点・重み・UV・
# テクスチャの alpha) は全部正しいのに、Blender でもゲームでも描かれなかった。
#
# 髪のカードは **MASK (アルファ抜き)** が本来正しい。BLEND は描く順に依存する
# ので、人数が増えるほど「誰の髪が誰の前か」で崩れる。抜きなら順序が要らない。
#
# 閾値は 0.25。0.5 だと房に隙間が空いて、髪越しに背景が見えた ("頭皮が透過して
# 向こう側が見える")。頭蓋に穴は無い (赤い背景を敷いて確かめた) ので、
# 透けていたのは髪カードのほう。下げるほど房は詰まるが、輪郭が硬くなる。
#
# 書き出しの設定では指定できないので、glb の JSON をその場で書き換える。
import json, struct

def mask_alpha(path, material, cutoff=0.25):
    raw=open(path,'rb').read()
    magic,ver,total=struct.unpack('<III', raw[:12])
    jlen,jtype=struct.unpack('<II', raw[12:20])
    doc=json.loads(raw[20:20+jlen].decode('utf-8'))
    rest=raw[20+jlen:]
    hit=0
    for m in doc.get('materials',[]):
        if m.get('name')==material:
            m['alphaMode']='MASK'; m['alphaCutoff']=cutoff
            hit+=1
    if not hit:
        print(f'  ! {material} が見つからない'); return
    blob=json.dumps(doc,separators=(',',':')).encode('utf-8')
    blob+=b' '*((4-len(blob)%4)%4)          # JSON チャンクは 4 バイト境界
    out=struct.pack('<III',magic,ver,12+8+len(blob)+len(rest))+struct.pack('<II',len(blob),jtype)+blob+rest
    open(path,'wb').write(out)
    print(f'  {material} を alphaMode=MASK (cutoff {cutoff}) にした')

mask_alpha(OUT, f'{P}_hair')
