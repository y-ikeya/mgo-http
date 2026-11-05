# 壁の上端に V 字の切れ込み (UU の concrete_wall2.002 と同じ作り)。**切れ込み越しに撃ち抜ける**
# (2026-11-05 本人「stair を登ってきたところをそのスリットから打ち抜けるように」)。
#
# 軸に沿った薄い壁 (箱) を、正面の輪郭 (V を切った多角形) を厚み方向へ押し出した閉じた形に作り直す。
# make_bb.py からも、開いている blend からも呼ぶ
import bmesh


def vnotch(o, center, top_width, bottom_z):
    """o: 軸に沿った薄い箱。center: 切れ込みの真ん中 (長い向きの座標)。bottom_z: V の底の高さ"""
    M = o.matrix_world
    ps = [M @ v.co for v in o.data.vertices]
    lo = [min(p[i] for p in ps) for i in range(3)]
    hi = [max(p[i] for p in ps) for i in range(3)]
    along = 0 if (hi[0] - lo[0]) >= (hi[1] - lo[1]) else 1
    across = 1 - along
    a0, a1 = lo[along], hi[along]
    z0, z1 = lo[2], hi[2]
    h = top_width / 2
    outline = [(a0, z0), (a1, z0), (a1, z1), (center + h, z1), (center, bottom_z), (center - h, z1), (a0, z1)]
    bm = bmesh.new()

    def vert(u, z, t):
        p = [0.0, 0.0, z]
        p[along] = u
        p[across] = t
        return bm.verts.new(M.inverted() @ __import__('mathutils').Vector(p))

    front = [vert(u, z, lo[across]) for u, z in outline]
    back = [vert(u, z, hi[across]) for u, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
