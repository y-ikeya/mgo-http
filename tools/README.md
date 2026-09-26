# tools

素材を作るためのスクリプト群。ゲーム本体からは呼ばれず、手で走らせる。

Blender はパスを通していないので、フルパスで叩く:

```
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
```

## ステージ

普段の流れはこう:

```
bun run stage        # tools/stage_*.blend を見張って、保存されたら書き出す
bun run stage mall   # 複数あるときは名前で選ぶ
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
| `make_stage.py` | 白紙から叩き台を起こす。**ステージは `stage_<名前>.blend`**。既にあれば**拒否する** |
| `make_lab.py` | 検証場 (stage_lab) を起こす。段の列・窓・低い通路・階段と床・堀・梯子・的。**上書きする** (叩き台で、手で育てない)。部屋 foxtrot で遊べる。URL に `?debug` を付けると HUD に旗と阻まれている理由が出る |

### 書き出しのときに調べていること

Blender の中では問題なく見えるのに、ゲームに入れて初めて壊れているのが分かる、
を減らすための検査。

- **90 度の倍数でない回転** — 判定は回す前の箱になるので、斜めの壁は思った形にならない
- **厚みの無い箱** — 判定が消える
- **知らない札** — `metall_` のような打ち間違いは、黙って既定の材質になる
- **置き物の細かさ** — 1 つ 400 枚を超える形は間引く (木箱は 1,600 → 400)。壁や床 (12 枚) は触らない
- **内向きの法線** — Plane を E で押し出した箱は面が内を向き、上面が透けて底の絵が見える。札を持つ箱は外向きに直して書き出す (Blender で直すなら Shift+N)

材質ごとの個数も出る。札の付け忘れは数を見ると気づける。

### ステージを作るときの制約

当たり判定は **XZ 平面の AABB + 上面の高さ**しか持っていない。

- 軸に沿った箱だけ。回した壁は回す前の箱として判定される
- アーチやトンネルの下はくぐれない。屋根は架けられない (壁で囲った中庭にする)
- 斜面は段の積み重ね。**ジャンプが無い**ので 1 段は 0.25m 以下 (`domain/player/moving.ts` の `STEP_UP`)
- 跳び越えられる物 (窓枠・塀・木箱) は上面を足元から **0.45〜1.2m** に。段差 (0.25) との間の高さ (0.26〜0.44m) は上がれず跳べもしないので置かない。目の前で前を押しながら Space を押すと跳び越える (`soldier.ts` の `vault`)。その上に 1m の隙間と、2m 先に床が要る

基地は `meta_` で始まり `base` を含む空 (Empty) で置く (`meta_baseBlue` /
`meta_baseRed`)。高さは真下の床に落とすので浮かせてよい。**書き出しが基地の
真ん中に工具箱を置く** (`tools/props/crate.blend` の `wood_toolbox`、筏の基地に
ある古い軍用の箱)。自分の .blend に箱を持っているステージ (名前に `toolbox` か
`old_military_crate`) には置かない。

オブジェクト名の接頭辞で役割を宣言する:

| 名前 | 意味 |
|---|---|
| `vis_◯◯` | 描画だけ。判定しない |
| `col_◯◯` | 判定だけ。描画しない |
| `metal_◯◯` | 錆びた金属。**見た目と足音の両方**が変わる |
| `concrete_◯◯` | コンクリート |
| `brick_◯◯` | 煉瓦。音と当たりはコンクリート。絵は自前 (材質に絵を繋いでおく) |
| `wood_◯◯` | 木。テクスチャの繰り返しが細かい (板の幅が見えるため) |
| `ladder_◯◯` | 梯子。登れる。材質の札の後ろでもよい (`metal_ladder_1`) |
| `◯◯stair◯◯` | 階段。**人が歩く面は書き出しが坂の板に置き換える** (段を踏むと頭が段ごとに跳ねるため)。見た目・弾・視線は段のまま。`vis_` を付けても坂は敷く。自分で `col_` を置いた階段には敷かない。板は箱の下端から上端へ張るので、最上段の天面は上の床と同じ高さにしておく |
| `ref_◯◯` | 書き出しから除外 (寸法の物差し) |
| `◯◯_nouv` | **UV を触らない。**焼き込んだ絵を持つ物に付ける (後置き)。材質に絵が繋がっていて面が多い物 (木箱など 60 面超) は付けなくても触らない。箱に繰り返しの絵を貼った物は貼り直す |
| 札なし | 描画も判定もする / 材質は金属 |

**繰り返しの絵と焼き込んだ絵は別。** 書き出しは材質の札が付いた物の UV を
立方投影で貼り直す。板・金属・コンクリートのように**繰り返す絵**なら箱の
大きさが変わっても伸びないが、持ち込んだモデルのように**1 枚に焼き込んだ絵**は
作り直すと崩れる。そういう物には `_nouv` を後置きする
(`wood_box_nouv` = 木の音と足音を持つが、絵は自前)。

札は組み合わせられる (`col_metal_wall`)。持ち込みのモデル (Sketchfab) は根の空 (Empty) に札を付ければよい — 書き出しが子のメッシュへ写す (`metal_rustCar1` の下の `Plane_Details_0` は金属の車として当たる)。Blender は複製すると名前の末尾に `.001` を足すので、**先頭に置く**ほうが壊れにくい。

**Blender 側でマテリアルを組む必要はない。** テクスチャはゲームが持っていて、
UV も箱の大きさに合わせてゲーム側で作り直している (Blender で貼った UV は
大きさの違う箱で伸び縮みしてしまう)。名前で材質を宣言するだけでよい。

## キャラクター

| | |
|---|---|
| `convert_character.py` | FBX 群 → 1 つの glb。設定ファイルを引数に取る |
| `soldier.json` | **どの FBX がどのクリップになったか**の対応表。32 本ぶん |
| `bake_stage.py` | ステージに**空の見え方**を焼く (頂点色)。単体で回すと .blend に保存する。書き出しに `-- --bake [試行回数]` を付ければ読み込んだ複製に焼いて .blend は触らない (city は 20 秒ほど)。形を共有している物 (Alt+D) は焼かれず一様の明るさ |
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

`convert_character.py` で全部作り直すと `throw` と `prone_throw` が 1 本ずつに
戻る。**割り直さないと手榴弾が投げられない** (コードは `throw_windup` /
`throw_release` を探す。伏せのほうは無ければ立ちへ落ちるので、投げられなくは
ならないが伏せの型が出ない)。

```
bun tools/split_clip.js public/models/soldier.glb throw 1.5 throw_windup throw_release
bun tools/split_clip.js public/models/soldier.glb prone_throw 0.95 prone_throw_windup prone_throw_release
```

1.5 秒は手が一番後ろ (腰から -0.48m) かつ高い (1.57m) 位置の実測値。ここで割ると
腕を引き切った形が前半の最後になり、`clampWhenFinished` がそのまま保持になる。

伏せの 0.95 秒も同じで、腕を上げたまま止まる所。**放す割合は型ごとに違う** —
手が一番高くなるのが立ちは後半の 23%、伏せは 38% (`knobs.ts` の
`GRENADE_RELEASE_RATIO` / `PRONE_GRENADE_RELEASE_RATIO`)。

### 横への転がりは後半だけ使う

`proneTurn.fbx` は**1 回転**する型 (うつ伏せ → 仰向け → うつ伏せ、1.13 秒)。
使うのは仰向けから戻る後半だけで、そこが吹き飛ばされた所から這い出す繋ぎになる
(転ぶ型 `sweep` は仰向けで終わる)。

```
bun tools/split_clip.js proneturn.glb prone_turn 0.30 prone_roll_up   prone_roll_rest
bun tools/split_clip.js proneturn.glb prone_roll_rest 0.50 prone_roll_down prone_roll_tail
bun tools/merge_clip.js public/models/soldier.glb proneturn.glb prone_roll_down public/models/soldier.glb
```

0.30 秒が仰向けになり切る所 (腹が真上を向く)、そこから 0.50 秒でうつ伏せへ戻る。
残り 0.33 秒は寝たまま動かない尾なので捨てる。**取り込むのは
`prone_roll_down` の 1 本だけ** — 前半 (`prone_roll_up`) は、仰向けで止まれる
姿勢を足すときに要る。

### 姿勢だけが欲しいときは両端を切り出す

しゃがみの脱力と構えは `kneeAim.fbx` 1 本の**両端**を使っている。始まりが銃を
下ろした形、終わりが構え。間の振り上げは上半身レイヤーの混ぜ合わせが作るので
要らない。

```sh
# 単体の glb にしてから、両端 3 標本ずつを切り出して 2 本だけ取り込む
$BLENDER -b --factory-startup --python tools/convert_character.py -- tools/raw/kneeaim.json
bun tools/split_clip.js kneeaim.glb knee_aim 0.067 knee_relaxed knee_rest
bun tools/split_clip.js kneeaim.glb knee_rest 0.700 knee_swing knee_ready
bun tools/merge_clip.js public/models/soldier.glb kneeaim.glb knee_relaxed public/models/soldier.glb
bun tools/merge_clip.js public/models/soldier.glb kneeaim.glb knee_ready  public/models/soldier.glb
```

**切り分けは取り込む前に済ませる。** soldier.glb の中で割ると、要らない中間
(`knee_swing`) と、参照されなくなった元データが残って 740KB 増えた。小さい
ほうで割ってから 2 本だけ足せば 180KB で済む。

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
| `tilt.ts` | **上半身の前後の傾き。**素材のクリップと、コードを回した合成後を並べる |
| `tilt_fbx.py` | 同じ定義を FBX に対して。**素材そのものと見比べる** |
| `chest_yaw.js` | クリップごとの背骨チェーンの向き |
| `obj_bounds.py` | OBJ の寸法と、銃身がどの軸か |
| `avg_color.py` | テクスチャの平均色と彩度 |
| `inspect_fbx.py` | FBX の中身 |


## 試写 (`preview/`)

**部屋に入らずに見る。** 対戦部屋へ入ると席を 1 つ潰すし、見たい場面が来る
まで待つことになる。見たい物だけを立てたページを開く。

`vite` を起こしてから `/tools/preview/<名前>.html`。

| | |
|---|---|
| `lobby` / `loadout` / `score` / `hud` | 画面の部品。対戦の状態は作り物を渡す |
| `icons` | **装備の画面の影絵を作る。** `?model=rifle` で glb を横から白一色に描く。絵 (テクスチャ) は読まない。`icons_sheet.html` で出来た物を並べて見る |
| `water` | 筏の水面と水しぶき。`?eye=near` で寄る、`?eye=drops` で粒に寄る、`?t=0.2` で叩いてからの秒数、`?fx=blood` で血 |
| `weapon` | **武器の構え。** 6 通り (立ち / しゃがみ / 伏せ × 脱力 / 構え) を同時に出す。`?weapon=knife` でナイフ (握りは立ちの 1 組) |
| `shots` | **銃口の煙と着弾。** 金属 (火花) と木 (煙) を撃ち分ける。`?only=metal` / `?only=wood` |
| `leaving` | 試合中に戻るを押したときの板。`?lang=en` |
| `decoy` | **decoy が膨らむ所。** 経過をずらして 4 体並ぶ。`?t=0.6` で全部同じ秒に、`?skin=` で見た目 |
| `blast` | **手榴弾の爆発。** 0.12 / 0.5 / 1.3 秒を横に並べる。`?t=0.4` で全部同じ秒に、`?view=low` で床すれすれから (破片の跳ね)、`?scale=0.2` で E LOCATOR が弾ける大きさ |
| `sensed` | **AWARENESS の気配。** 壁の裏に 2 つ、手前に 1 つ霧を置く。壁越しに見えるか、物に見えないかを見る |
| `locator` | **置かれた E LOCATOR。** 左が自分の物 (光の玉が出る)、右が敵の物。`?shade=1` で日陰 (灯の光が床に落ちるのを見る)、`?off=1` で灯が消えている瞬間 |

`decoy` も**時を止めて 1 枚**。膨らむのは 2 秒しかないので、動かして見ると
速すぎて形を比べられない。見るのは 2 つ — **下から膨らんでいるか** (模型の
原点は腰なので、素直に scale を掛けると腰を中心に伸びて床へめり込む) と、
**平たい台があるか** (よく見れば偽物だと分かる手掛かり)。

`shots` の下地は**明暗が半分ずつ**。煙は灰色なので、暗い壁だけだと「出ていない」
のか「見えていない」のかが分からない。撃った絵は 0.2〜0.5 秒で消えるので、
同じ場所へ撃ち続けて止めずに見る。

`water` は**時を止めて 1 枚描く**。柱 (0.4 秒) と波紋 (1.2 秒) は寿命が 3 倍
違うので、動かして見ると速すぎて比べられない。

`weapon` は**6 枚を同時に出す**。対戦の中の調整パネルは 1 つの姿勢しか映らない
ので、構えを合わせている間に脱力の型が壊れても気づけない。値は 3 組 (立ち /
しゃがみ / 伏せ) で、構えているかどうかは型が変えている — **同じ握りが両方で
成り立つか**を見るために並べてある。右の板で動かすと 6 枚が同時に動き、
`weapon.ts` へ貼れる形で出る。

```sh
# 撮る (WebGPU なので旗が要る)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --enable-unsafe-webgpu --use-angle=metal \
  --screenshot=/tmp/water.png --window-size=1280,720 --virtual-time-budget=14000 \
  "http://localhost:5199/tools/preview/water.html?eye=near&t=0.1"
```


### 装備の影絵を作り直す

`public/icons/<id>.png` は `icons` の試写を透明背景で撮った物。模型を差し替えたら撮り直す:

```sh
for m in rifle smg sniper mosin shotgun m9 grenade claymore locator soldier; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --default-background-color=00000000 --hide-scrollbars --window-size=240,120 \
    --screenshot=public/icons/$m.png --virtual-time-budget=60000 \
    "http://localhost:5199/tools/preview/icons.html?model=$m"
done
```

`rifle`・`mosin`・`sniper` は `&flip` を付ける (模型が逆向きに寝ている)。`soldier` は `decoy.png` に名前を変えて置く (人形は兵士の模型そのもの)。`m1911.glb` は形が
数 cm の欠片しか入っていないので、`m1911.png` は `m9.png` の写し。

## 元データの置き場

変換前の FBX / 落としてきたモデル / テクスチャの副産物は `tools/raw/` に置く。
追跡しない (`.gitignore` の 1 行)。`tools/props/` も同じだが、書き出しが毎回読む物 (基地の工具箱 `crate.blend` と
`textures/`) だけは `.gitignore` で除外を外して追跡する — 無いと書き出しが止まる。合計 800MB 以上あり、一度変換したら普段は触らない。

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
`hard_land` `up_stair` `down_stair` `bump` `crawl_f` `prone_down` `prone_rise` `prone_fire` `prone_reload` `death_front` `death_back`
`knee_relaxed` `knee_ready` `prone_bolt` `knife_idle` `vault` `vault_up` `hang_drop` `hang_climb`) は
`soldier.json` を通さず `merge_clip.js` で 1 本ずつ足してある。FBX は
`tools/raw/` にあるので、単体の glb に変換してから差し替える:

    $BLENDER -b --factory-startup --python tools/convert_character.py -- <1本だけの設定.json>
    bun tools/merge_clip.js public/models/soldier.glb <単体.glb> <クリップ名> public/models/soldier.glb

`knife_idle` (tools/knife_idle.json) と `stab` (tools/stab.json) は **Ch35 ではないキャラで落とした FBX** (背丈が半分、素の姿勢も違う) なので、`convert_character.py` で直に写すと腕が頭の上に上がる。`retarget_clip.py` で世界の向きから焼き直し、腰の高さが半分なので `--hips-from` で既存の型の高さに揃えて足す:

    $BLENDER -b --factory-startup --python tools/retarget_clip.py -- tools/knife_idle.json
    bun tools/merge_clip.js public/models/soldier.glb knife_idle.glb knife_idle public/models/soldier.glb --hips-from pistol_aim
    bun tools/merge_clip.js public/models/soldier.glb stab.glb stab public/models/soldier.glb --hips-from idle

`lean` (tools/lean.json、覗きながら傾く) も同じで、使うのは 3 本目 (`#3`)。1 本の中で左 (5 コマ目) と右 (13 コマ目) に傾くので、ゲームはその 2 点で止めて使う。しゃがみは `lean_crouch` (tools/lean_crouch.json、1 本、左 4 コマ目 / 右 10 コマ目) で、腰は `--hips-from crouch_idle`。`prone_stab` (tools/prone_knife.json) も同じ。FBX には立ちの刺突 2 本と伏せの 2 本が入っていて、使うのは 4 本目 (`#4`)。腰は `--hips-from prone_fire` で伏せ撃ちの高さに揃える (crawl_f に揃えると 10cm 浮く)。伏せてナイフを構えた姿はこの型の頭の 1 枚を止めて使う。

`vault` (tools/vault.json、窓枠を跳び越える) は Ch35 と同じ体つきの FBX (JumpingOver.fbx、
Mixamo の 41 コマ) なので `convert_character.py` で直に写せる。腰の移動 (前へ 2.06m、
上へ 0.5m) を辿る型 (animation.ts の ROOT_MOTION_CLIPS) なので、3 体とも
`--rotation-only` を**付けずに**入れる (腰の高さは 3 体とも同じ 0.97m):

    $BLENDER -b --factory-startup --python tools/convert_character.py -- tools/vault.json
    for g in soldier soldier_raiden soldier_nanashi; do bun tools/merge_clip.js public/models/$g.glb vault.glb vault public/models/$g.glb; done

ゲームでは目の前に低い物 (上面が足元から 0.45〜1.2m、上に 1m の隙間、先に
立てる床) がある状態で**前を押しながら** Space (パッドはスティック前 + 転がりのボタン) を押すとこれが出る (止まって押せばしゃがみ)
(soldier.ts の vault / canVaultAhead)。押した瞬間に跳ぶので、しゃがみにも転がりにもならない。
札は要らない。**窓枠は 1.2m より低く置く。** それより高いと壁。

`vault_up` (tools/vault_up.json、RunningJumpUp.fbx、1.0 秒) は同じ入れ方で、枠の先の床が
枠の上面と同じ高さ (差 0.35m 以内) のときに出る — 箱の上や続いている床へ**一段上へ
乗る**。型は 0.9m の段に合わせて焼かれているが乗る物の高さは物ごとに違うので、
腰の上下は型から抜き (animation.ts の VERTICAL_STRIP_CLIPS)、位置のほうを型の
上がり方 (vaultRise) に沿って乗る先まで上げる。

`hang_drop` / `hang_climb` (tools/hang.json、BracedHang.fbx 1.13 秒 / BracedHangToCrouch.fbx
1.17 秒) は縁にぶら下がる。歩いて縁から出て下が 1.6m 以上深ければ、落ちずに `hang_drop` で
縁に手を掛ける (武器は消える)。型は始めから壁向きで回転を持たないので、出た向きから壁向きへ
型の頭 (27%) で 180° 回す (soldier.ts の HANG_TURN_PHASE)。落ち切ったら、その型の最後の 1 枚を
止め絵 (locomotion `hang`) にして待つ。前 (W) で `hang_climb` を流して縁の上に
しゃがみで戻り、Space で手を離して落ちる。位置は型の腰の曲線に沿って動かし、ぶら下がって
いる間は地形の当たりを取らない。壁との距離は tools/preview/hang.html で測れる
(`?clip=hang_drop&yaw=0&out=0.17&below=1.78`、シークバー付き)。上下は 2 本とも型から抜き、位置を型の腰の
曲線に沿って動かす (soldier.ts の hangMovement)。ぶら下がっている間は地形の当たりを
取らない (梯子と同じ)。

雷電と名無しへは同じ物を `--rotation-only` を足して入れる。`knife_idle` は半身の構えで腰が 90° 横を向いているが、手と頭は他の構えと同じ方を向いているので回してはいけない。上半身だけ乗せると腰の基準合わせで捻れるため、ゲームでは立ち止まって構えた間だけ全身で使う。
