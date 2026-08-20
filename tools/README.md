# tools

素材を作るためのスクリプト群。ゲーム本体からは呼ばれず、手で走らせる。

Blender はパスを通していないので、フルパスで叩く:

```
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
```

## ステージ

普段の流れはこう:

```
bun run stage        # tools/stage.blend を見張って、保存されたら書き出す
```

Blender で `Ctrl+S` を押すと glb が作り直され、Vite がページを読み直す。
手で書き出す手順を挟まないのは、「直したのに反映されていない状態で見比べる」が
一番面倒な詰まり方だから。

| | |
|---|---|
| `watch_stage.ts` | 保存を見張って書き出す。**普段使うのはこれ** |
| `export_stage.py` | 1 回だけ書き出す。書き出す前に形を検証する |

書き出されるのは 2 つ:

| | |
|---|---|
| `public/models/stage.glb` | 見た目と、クライアント側の当たり判定 |
| `public/models/stage.json` | 箱の位置と寸法だけ。**サーバーが遮蔽の判定に使う** |

サーバーが glb を解析する必要は無い。要るのは箱の形だけで、それは書き出しのときに
分かっている。同時に書くので、片方だけ古い形を見ていることが起きない。
| `make_stage.py` | 白紙から叩き台を起こす。`tools/stage.blend` があれば**拒否する** |

### 書き出しのときに調べていること

Blender の中では問題なく見えるのに、ゲームに入れて初めて壊れているのが分かる、
を減らすための検査。

- **90 度の倍数でない回転** — 判定は回す前の箱になるので、斜めの壁は思った形にならない
- **厚みの無い箱** — 判定が消える
- **知らない札** — `metall_` のような打ち間違いは、黙って既定の材質になる

材質ごとの個数も出る。札の付け忘れは数を見ると気づける。

### ステージを作るときの制約

当たり判定は **XZ 平面の AABB + 上面の高さ**しか持っていない。

- 軸に沿った箱だけ。回した壁は回す前の箱として判定される
- アーチやトンネルの下はくぐれない。屋根は架けられない (壁で囲った中庭にする)
- 斜面は段の積み重ね。**ジャンプが無い**ので 1 段は 0.25m 以下 (`collision.ts` の `STEP_UP`)

オブジェクト名の接頭辞で役割を宣言する:

| 名前 | 意味 |
|---|---|
| `vis_◯◯` | 描画だけ。判定しない |
| `col_◯◯` | 判定だけ。描画しない |
| `metal_◯◯` | 錆びた金属。**見た目と足音の両方**が変わる |
| `concrete_◯◯` | コンクリート |
| `wood_◯◯` | 木。テクスチャの繰り返しが細かい (板の幅が見えるため) |
| `ref_◯◯` | 書き出しから除外 (寸法の物差し) |
| 札なし | 描画も判定もする / 材質は金属 |

札は組み合わせられる (`col_metal_wall`)。Blender は複製すると名前の末尾に `.001` を足すので、**先頭に置く**ほうが壊れにくい。

**Blender 側でマテリアルを組む必要はない。** テクスチャはゲームが持っていて、
UV も箱の大きさに合わせてゲーム側で作り直している (Blender で貼った UV は
大きさの違う箱で伸び縮みしてしまう)。名前で材質を宣言するだけでよい。

## キャラクター

| | |
|---|---|
| `convert_character.py` | FBX 群 → 1 つの glb。設定ファイルを引数に取る |
| `soldier.json` | **どの FBX がどのクリップになったか**の対応表。32 本ぶん |
| `merge_clip.js` | 既存の glb にクリップだけ追加する。全体を作り直さずに済む |
| `split_clip.js` | **クリップを 2 本に割る。** 境目の姿勢は補間して両方に入れる |

```
# 全部作り直す (元の FBX が全部要る)
$BLENDER -b --factory-startup --python tools/convert_character.py -- tools/soldier.json

# 1 本だけ足す
$BLENDER -b --factory-startup --python tools/convert_character.py -- one.json
bun tools/merge_clip.js public/models/soldier.glb new.glb sneak out.glb
```

### 作り直したら投擲を割り直すこと

`convert_character.py` で全部作り直すと `throw` が 1 本に戻る。**割り直さないと
手榴弾が投げられない** (コードは `throw_windup` / `throw_release` を探す)。

```
bun tools/split_clip.js public/models/soldier.glb throw 1.5 throw_windup throw_release
```

1.5 秒は手が一番後ろ (腰から -0.48m) かつ高い (1.57m) 位置の実測値。ここで割ると
腕を引き切った形が前半の最後になり、`clampWhenFinished` がそのまま保持になる。

**割る理由**は「止める位置をコードが絶対秒で持たなくて済む」こと。以前は
`THROW_HOLD_AT = 1.5` を持っていて、尺の違うモデルに差し替えると別の場所を指した
(移植したモデルが 25% 速く、振り切ったあとを指して「押しっぱなしなのに手を
振り下ろす」になった)。

`merge_clip.js` はチャンネルの対象を**ノード名で対応付ける**。索引で合わせると、書き出しのたびにノード順が変わった場合に静かに壊れる。

### モーションを足すとき

必要なのは**アニメーションだけ**でメッシュは要らない。ただしボーンの名前と構造が一致していること。

Mixamo なら `Shooter Pack/Ch35_nonPBR.fbx` をアップロードすれば、この骨格にリターゲットされた FBX が返ってくる。**この FBX を消すと Mixamo からモーションを取れなくなる。**

別パック由来のクリップは座標系がずれていることがある (実測で `relaxed_*` が 31°、`sit` も同様)。`animation.ts` が腰の基準を載せ替えて吸収するので手当ては要らないが、**上半身と下半身を同じクリップから取る場合は補正を掛けない** (掛けると逆に捻れる)。

## 武器

| | |
|---|---|
| `convert_gun.py` | FBX の銃 → glb。Principled BSDF の Alpha を 1 に固定する (FBX の透明扱いで消える事故があった) |
| `convert_ak.py` | OBJ の銃 → glb。軸と全長を正規化して、銃口を既存モデルと同じ位置へ揃える |
| `convert_gltf_gun.py` | glTF の銃 → glb。**ボーンを剥がし**、銃身の軸を頂点から自動判定する |
| `convert_casing.py` | 弾のモデルから**弾頭を落として薬莢にする**。長辺を +Y へ立てて実寸に合わせる |

規約は**銃口が -Z、上が +Y**。`convert_ak.py` は銃身の軸を頂点から自動で判定する (最長軸を取り、両端の断面が細いほうを銃口とみなす)。

銃身回りの回転 (roll) までは合わせていないので、そこは調整パネルで詰める。

## テクスチャ

| | |
|---|---|
| `exr2jpg.py` | EXR → JPEG。three は EXR を標準で読めず、法線や粗さに HDR の精度は要らない |
| `desaturate.py` | 彩度を抜く。マテリアル側では色を掛けることしかできず、彩度は下げられない |
| `shrink_glb.js` | glb に埋め込まれた JPEG を縮める |

Poly Haven の素材は `diff` (sRGB) / `nor_gl` / `rough` を使い、`disp` は使わない (頂点を細分化していない平面には効かない)。

## 測る (`measure/`)

目で判断できない値を数字にする。**推測して往復するより速い。**

| | |
|---|---|
| `list_clips.js` | glb のクリップ名と尺 |
| `crouch_size.js` | 姿勢ごとの高さ・幅・頭の位置。箱の寸法を決めるのに使った |
| `stride.js` | その場歩きのクリップから実効速度を歩幅で推定。歩行なら誤差 5% |
| `clip_speed.js` | ルートモーションから移動速度。取り除かれていると 0 が返る |
| `twist.js` | 肩のラインと腰のラインの差 = 上半身のねじれ |
| `chest_yaw.js` | クリップごとの背骨チェーンの向き |
| `obj_bounds.py` | OBJ の寸法と、銃身がどの軸か |
| `avg_color.py` | テクスチャの平均色と彩度 |
| `inspect_fbx.py` | FBX の中身 |


## 元データの置き場

変換前の FBX / 落としてきたモデル / テクスチャの副産物は `tools/raw/` に置く。
追跡しない (`.gitignore` の 1 行)。合計 800MB 以上あり、一度変換したら普段は触らない。

`soldier.json` がどの FBX をどのクリップにしたかを記録しているので、
元データが無くなっても取り直せる — ただし**次の 5 本は既に手元に無い**:

    Rifle Idle.fbx        → relaxed_idle
    Rifle Run.fbx         → relaxed_run
    Stabbing.fbx          → stab
    Running Dive Roll.fbx → roll
    Hit Reaction.fbx      → hit

soldier.glb には焼き込まれているので今は動く。作り直すときはこの 5 本を
Mixamo から取り直す必要がある。1 本足りないまま書き出すと、そのモーションが
静かに消えて素の姿勢 (T ポーズ) が出る。

後から足したクリップ (`salute` `bolt` `sweep` `stand` `stand_front` `throw` `away`
`fall_roll`) は
`soldier.json` を通さず `merge_clip.js` で 1 本ずつ足してある。FBX は
`tools/raw/` にあるので、単体の glb に変換してから差し替える:

    $BLENDER -b --factory-startup --python tools/convert_character.py -- <1本だけの設定.json>
    bun tools/merge_clip.js public/models/soldier.glb <単体.glb> <クリップ名> public/models/soldier.glb
