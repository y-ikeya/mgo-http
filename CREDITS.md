# 使っている素材

外から持ってきた素材と、その権利。**表示が要るものが混ざっている**ので、
公開する場所にはここへの導線を置くこと。

素材そのもの (変換前の FBX / gltf) は `tools/raw/` にあり、リポジトリには
入っていない (合計 800MB 以上あるため)。変換の手順は `tools/` の各スクリプトの
冒頭に書いてある。

## 表示が要るもの

| 素材 | 使い道 | 作者 | 権利 |
|---|---|---|---|
| [Old Rusty Car](https://sketchfab.com/3d-models/old-rusty-car-95baa20ebc5d4d2e869f0b549be838fe) | 立体駐車場に停めてある車 | [Renafox](https://sketchfab.com/kryik1023) | CC-BY-**NC** 4.0 |
| [Small price car](https://sketchfab.com/3d-models/small-price-car-67c84e4d30ae42fda22c0a0c7526df26) | 同上 | [Oliv1e](https://sketchfab.com/Oliv1e) | CC-BY 4.0 |
| [P90 Final](https://sketchfab.com/3d-models/p90-final-cd59e752d0a34623a0e61a5623ee2762) | サブマシンガン (`public/models/smg.glb`) | [charles.cla](https://sketchfab.com/charles.cla) | CC-BY-**NC** 4.0 |

そのまま貼る文言:

> This work is based on "Old Rusty Car" (https://sketchfab.com/3d-models/old-rusty-car-95baa20ebc5d4d2e869f0b549be838fe) by Renafox (https://sketchfab.com/kryik1023) licensed under CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)

> This work is based on "Small price car" (https://sketchfab.com/3d-models/small-price-car-67c84e4d30ae42fda22c0a0c7526df26) by Oliv1e (https://sketchfab.com/Oliv1e) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

> This work is based on "P90 Final" (https://sketchfab.com/3d-models/p90-final-cd59e752d0a34623a0e61a5623ee2762) by charles.cla (https://sketchfab.com/charles.cla) licensed under CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)

### NC (非営利) が 2 つ混ざっている

Old Rusty Car と P90 は **商用利用ができない**。いま遊びで作っている分には
問題ないが、広告を置く・課金する・仕事の実績として売る、といった話が出たら
どちらも差し替えることになる。

- 車 … `tools/props/car_rusty.glb`。`tools/convert_car.py` に同じ全長を渡す
- P90 … `public/models/smg.glb`。別の glTF を拾って

      $BLENDER -b --factory-startup --python tools/convert_gltf_gun.py -- \
          <scene.gltf> public/models/smg.glb 0.5 max

  で同じ規約に揃う (銃口が -Z、全長 0.5m)。握りの位置は Calibrator で詰め直す。

## 表示が要らないもの

| 素材 | 使い道 | 出どころ | 権利 |
|---|---|---|---|
| Smoke Particle pack | 爆発の粒 (`public/textures/particles.png`) | Kenney | CC0 |
| 各種テクスチャ | 地面・壁・木 (`public/textures/`) | Poly Haven | CC0 |
| キャラクターのモーション | 兵士の全モーション | Mixamo | Adobe の利用条件に従う |

## 車を差し替える / 作り直すとき

`tools/raw/` と `tools/props/` はリポジトリに入っていないので、白紙から起こすなら
上の 2 つを落としてくるところから。

```
# 1. Sketchfab から glTF で落として tools/raw/ へ展開する
# 2. 実寸に直す (全長を渡す。地面の板は自動で捨てる)
$BLENDER -b --factory-startup --python tools/convert_car.py -- \
    tools/raw/old_rusty_car/scene.gltf tools/props/car_rusty.glb 4.6
$BLENDER -b --factory-startup --python tools/convert_car.py -- \
    tools/raw/small_price_car/scene.gltf tools/props/car_small.glb 4.2
# 3. ステージを組み立てて書き出す
rm -f tools/garage.blend
$BLENDER -b --factory-startup --python tools/make_garage.py
$BLENDER -b tools/garage.blend --python tools/export_stage.py
```
