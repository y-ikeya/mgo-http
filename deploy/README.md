# 箱の上に置くもの

対戦サーバーを動かしている機械 (Lightsail / 東京) の設定。**ここに無いものは
箱の上にしか無い**ので、インスタンスを作り直したら復元できなくなる。

| | 置き場所 | 秘密 |
|---|---|---|
| `mgohttp.service` | `/etc/systemd/system/` | なし |
| `Caddyfile` | `/etc/caddy/` | なし |
| `.env` | `/home/ubuntu/mgohttp/` | **あり** (追跡しない) |

`.env` だけは repo に入れない。何が要るかは `.env.example` に書いてある。

## 作り直すとき

```
make push-env       手元の .env を箱へ送る
make setup-server   unit と Caddyfile を配って有効化する
make deploy         コードを入れる
```

前提として、箱の側に以下が要る (最初の 1 回だけ手で):

- `bun` (`curl -fsSL https://bun.sh/install | bash`)
- `caddy` (`apt install caddy`)
- リポジトリの clone (`git clone <url> /home/ubuntu/mgohttp`)
- Lightsail のファイアウォールで 80 / 443 を開ける。22 は自分の IP だけ

## なぜ Caddy を挟むか

証明書を自動で取って自動で更新する。それだけのために置いている。

`/v1` はここで剥がすので、サーバー側のコードは**自分がどの経路で呼ばれたかを
知らないまま**でよい。後から作りを変えたときに `/v2` を並べて、古いクライアントを
動かし続けられる。

WebSocket は素通しする (Caddy が `Upgrade` を勝手に扱う)。

## なぜ systemd か

部屋の状態はメモリにあるので、落ちたら試合が消える。**必ず起動し直す**必要がある。
`Restart=always` と `StartLimitIntervalSec=0` は、落ちた回数を数えて諦めることが
ないようにするため。
