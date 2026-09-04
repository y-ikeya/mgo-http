# src の歩き方

**どこに何を書くか**を決めるための地図。層の順序そのものは
[layers.test.ts](layers.test.ts) の表 1 つで宣言してあり、破ると試験が落ちる。

```
domain        遊びの語彙と数字          依存なし
  ↑
sim           世界に訊く手続き          domain の**型だけ** (値は引数で受け取る)
  ↑
application   こちら側の状態と、外との約束
  protocol/     線を流れる形 (client と server の約束)   domain の語彙だけ
  replica/      サーバーの状態を追う                     domain / protocol
server/       審判。状態を持ち、配る    domain / sim / protocol  (src の外)
  ↑
presentation  見せる・聞かせる          上の全部 + three

infra/        外と繋ぐ口 (差し替えの壁)。**遊びの状態は持たない**
  input.ts    押されたか。装置 (キーボード / パッド)   依存なし
  codec/      位置をバイトへ詰める                    application/protocol
  link/       回線 (WebSocket)                        application/protocol / codec
  api/        外の口 (部屋一覧・戦績)                  protocol / domain / …
  auth/       誰なのか。発行元の都合はここで止まる       依存なし
```

**infra が消えても遊びの状態は残るが、application が消えたら運ぶ物が無くなる。**
その向きが層の位置を決めている。WebTransport にしても認証を移しても、
書き換えるのは `infra/` の下だけで済む、という形を保つ。

## 迷ったときの問い

**それを触る理由は何か。**

| 触る理由 | 置き場所 |
|---|---|
| 遊びを変えたい | `domain` |
| そう見えない / 破綻するから直す | `sim` (世界の側) / `presentation` (見え方) |
| 送る物が変わった | `protocol` |
| 誰が状態を持ち、いつ配るか | `server/` と `application/replica` |

判定に使える 2 つ:

1. **その数字を変えたら、プレイヤーの判断が変わるか。** 装弾数 30→10 なら
   「撃ち続けるか温存するか」が生まれる (domain)。階段と読む落差を 0.15→0.2 に
   しても誰の判断も変わらない (sim)
2. **壊れたとき「バグ」と呼ぶか「ルール変更」と呼ぶか。** ルール変更と呼ぶ物が
   domain

対にして並べると分かりやすい。

```
「頭に当たったら 100」                 domain
「その弾は頭に当たったか」             sim
「クレイモアが見張るのは前方 60 度」   domain
「いまその扇の中に居るか」             sim
「爆風は 7m で 75、遮蔽の裏は 1/4」    domain
「体の何点が爆心から見えていたか」     sim
```

## それぞれの棚

### domain — 遊びの語彙と数字

**ここが数字の出どころ。** 装弾数も残機も爆風も、まず
[domain/README.md](domain/README.md) の表を変えてからコードを合わせる。ずれたら
`spec.test.ts` が落ちる。

```
player/   人。削られる / 倒される / 何を持てるか / 構え / 動ける段差
match/    試合。部屋とルール (誰が敵か)・残機・点
item/     持ち物。武器の性能・手に持てる物・手榴弾・クレイモア
stage/    面。材質 (足音) と、何を止めるか (人 / 弾 / 視線)
rule/     どの entity のものでもない判断。ダメージ・足音・音・遅れの許容
```

置かないもの: 三角関数、レイ、時計、通信、three。**直下に .ts を置かない**
(棚に入れる)。

### sim — 世界に訊く手続き

主語が「世界」であるもの。世界に訊けば答えが決まる問いだけ。

```
judge/   当たったか — 弾道・被弾の検算・爆風・クレイモア・姿勢の照合
space/   どこに居られるか / 何が届くか — 押し戻し・移動・視線・目の位置・音
```

**domain を import しない。数字も関数も引数で受け取る。** 型だけ共有する
(`Pose` / `Stance` / `Surface`)。幾何の層が遊びの数字を直に読むと、間合いを
0.1m 変えただけで幾何の試験が動くし、「その数字で答えが変わる」ことが呼ぶ側から
見えない。

```ts
triggeredBy(mine, target, range, cos)                    ← 扇の中に居るか
blastExposure(cx, cy, cz, target, head, radius, boxes)   ← 何 m 先にどれだけ晒されたか
verifyHit(attacker, target, claim, boxes, window, rules) ← その申告は通るか
```

渡す物は domain が束ねて持っている (`rule/damage.ts` の `HIT_RULES`)。
**呼ぶ側で直値を書かない** — それをやると、サーバーとクライアントで別の数字を
渡す余地が戻る。

### protocol — 通信で流れる形

**通信で流れるデータの形式**。中身は 2 つだけ。

```ts
// types.ts — やり取りする JSON メッセージの型
{ type: 'kill', killer: 'alice', victim: 'bob', weapon: 'AK47', headshot: true }
{ type: 'health', id: 'bob', health: 45, damage: 55 }
```

```
// snapshot.ts — 位置だけは JSON ではなく 37 バイトのバイト並び。
// 64Hz で全員ぶん流れるので、{"x":12.5,…} だと桁違いに重い
0-1   席番号と旗        12-13  向き (yaw)
2-13  座標 x / y / z    14     モーション番号   ← LOCOMOTIONS の並びがそのまま乗る
                       …      計 37 バイト
```

**server も client も同じものを読む。**

domain の**射影**で、語彙を決めるのは向こう。ただし**縛りが逆**:

```
domain    Locomotion 型 = どんな動きがあるか   → 自由に足す・消す・並べ替える
protocol  LOCOMOTIONS  = 何番を振るか          → **末尾追記のみ。並べ替え禁止**
```

番号がそのまま通信に乗るので、順序を変えると古いクライアントが別のモーションを
再生する。「使っていないから消す」ができない型があるのはこのため。

### application/replica — こちら側の状態のレプリカ

サーバーが持っている状態を、クライアント側で追従するだけの層。**決めない。**

```
match.ts    試合のレプリカ — 段階・残機・得点・自分の所属・1 位・キルログ・点
roster.ts   名簿のレプリカ — 誰が居て、名前・所属・体力・状態はどうか
self.ts     自分のレプリカ — 体力・弾数・投擲物。予測とのずれを出す
```

**`server/` と同じ高さの双子。** どちらも状態を持ち、報せを受けて更新する。
違うのは決めるか従うかだけ。`server/` が「サーバーを立てる」仕事を持つのに
対して、`application` は**その状態の形**を持つ。

three も presentation も読めない。層を引くときに長い名前から先に当てるので、
`application/replica` は親 (`application`) とは別の行として検査される
(`layers.test.ts`)。

報せを受けてレプリカを進め、**やることは返り値で返す**（`MatchEffect`）。three も
音も知らないので GL 無しで試せる — ここは長いあいだ 218 秒の統合試験でしか
触れなかった。

**体はレプリカを見て姿を合わせるだけ。** 名簿はもともと three のオブジェクト
(`RemoteSoldier`) が持っていて、位置が届く前に来た報せは `pending` に溜めて
いた — 体が無い相手のことは体のクラスに聞くしかない、という形だった。

`receive()` に残っているのは**出すことだけ** (弾・爆発・音・落ちている物)。

`server/` と同じ高さの双子で、違うのは**決めるか従うか**だけ。同じ語彙で書いて
おくと、「サーバーが持っている状態」と「クライアントが思っている状態」の
食い違いが型で見える。

### presentation — 見せる・聞かせる

```
scene/     three で世界を出す
  Game.ts     まとめ役。毎フレームここから降りていく
  actor/      人 — 自機・他人・モーション・当たり判定・ダンボール
  arms/       武器と投げた物 — 銃・散布と反動・手榴弾・クレイモア・落ちている銃
  fx/         見た目だけの物 — 爆発・排莢・着弾痕
  sense/      知覚 — カメラ・音・音の輪
  world/      ステージ
  util/       three と数の小物
  knobs.ts / calibration.ts   手触りの仮置きと、調整パネルの受け口
ui/        HUD と部品 (Solid)
screens/   画面の遷移 (Login / Lobby / Play)
```

`knobs.ts` は**遊びのドメインルールではない**。「撃ってからボルトに手を掛けるまで 0.54 秒」
のような、見ていて忙しなくないかで決まる数字。**決まったら domain へ移す** —
弾の落下がそうだった。

### 端

```
input.ts   パッドとキーボード。**何も import しない**
link/      WebSocket・再接続・サーバーの居場所
api/       部屋一覧・Lv・戦績 (HTTP)。使うのは画面
auth/      切符 (token) と身元
```

## よくある「どこに書く？」

| やりたいこと | 書く場所 |
|---|---|
| 武器を 1 挺足す | `domain/README.md` の表 → `domain/item/weapons.ts` → `protocol/snapshot.ts` の番号を**末尾に**追加 → `presentation/scene/arms` にモデル |
| 威力や射程を変える | `domain/README.md` の表 → `domain/item/weapons.ts` |
| 新しいモーション | `domain/player/locomotion.ts` に名前 → `protocol/snapshot.ts` の並びに**末尾追加** → `presentation/scene/actor/animation.ts` にクリップ |
| 新しい通信 | `protocol/types.ts` に形 → `server/` に処理 → 受け側 |
| 当たり判定が変 | `sim/judge/` |
| すり抜ける・登れない | `sim/space/collision.ts` |
| HUD の表示 | `presentation/ui/` (状態は `Game.ts` の `publishStats` 経由) |
| 動きが変に見える | `presentation/scene/actor/motion.ts` (どの型を流すか) |
| 手触りの微調整 | `presentation/scene/knobs.ts` → 決まったら domain へ |
| チートを塞ぐ | `server/damage.ts` (検算) と `domain` (ドメインルール) |

## server/ (src の外)

審判。**上から全部を読む側**なので、層の順序では縛らない。代わりに
**中に循環が無い**ことだけ試験で見る (呼び合うと、どちらが上か決まらない)。

```
index.ts   起動と口 (HTTP / WS / 1 通の振り分け / 刻み)
world.ts   部屋の世界。試合と、その中に在る物。配る相手もここ
session.ts 接続 (人とは別。的は MatchPlayer を持つが Session を持たない)
stage.ts   ステージの箱
match.ts   段階と時計
damage.ts  申告を検算して体力を削る。**その先の始末は呼ぶ側に返す**
relay.ts   誰に何を見せるか (位置・音・弾・体力)
arms/      権威側の手榴弾・クレイモア・落ちている武器
```

## もっと知りたい

- [domain/README.md](domain/README.md) — このゲームのドメインとは何か。数字の表
- [../docs/design.md](../docs/design.md) — なぜこの遊びなのか。7 章が置き場所
- [layers.test.ts](layers.test.ts) — 層の順序の宣言。ここが唯一の真実
