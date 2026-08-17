# 配置と運用の手順。
#
# 手で打つと、鍵の場所や再起動の順番を毎回思い出すことになる。
# ここに書いておけば、次に触るのが 3 ヶ月後でも同じことができる。
#
#   make            使える操作の一覧
#   make deploy     クライアントとサーバーを両方入れ替える

# --- 配置先 ---------------------------------------------------------------
# クライアントは Cloudflare Pages、サーバーは Lightsail (東京)。
# 分けているのは、静的配信は通信量が無料で、対戦は常駐が要るため。
SERVER_HOST := 43.206.62.163
SERVER_USER := ubuntu
SERVER_KEY  := ~/.ssh/mgoh-key.pem
SERVER_DIR  := /home/ubuntu/mgohttp
PAGES_PROJECT := mgohttp

SSH := ssh -i $(SERVER_KEY) $(SERVER_USER)@$(SERVER_HOST)

.PHONY: help dev serve build test check deploy deploy-web deploy-server setup-server push-env logs status ssh restart

help:
	@echo '手元で動かす'
	@echo '  make check          型と試験と組み立て。CI もこれを呼ぶ'
	@echo '  make test           試験だけ (50 秒ほどかかる)'
	@echo '  make dev            画面 (vite)。サーバーは同じホストの 8787 を見る'
	@echo '  make serve          対戦サーバー。保存すると勝手に読み直す'
	@echo ''
	@echo '配置する'
	@echo '  make deploy         クライアントとサーバーを両方'
	@echo '  make deploy-web     クライアントだけ (Cloudflare Pages)'
	@echo '  make deploy-server  サーバーだけ (Lightsail)'
	@echo ''
	@echo '箱を仕立てる (作り直したときだけ)'
	@echo '  make push-env       手元の .env を箱へ送る'
	@echo '  make setup-server   systemd と Caddy の設定を配って有効化'
	@echo ''
	@echo '様子を見る'
	@echo '  make status         本番が生きているか'
	@echo '  make logs           サーバーのログ (末尾 50 行)'
	@echo '  make ssh            サーバーに入る'
	@echo '  make restart        サーバーを再起動'

# --- 手元 -----------------------------------------------------------------

dev:
	bun run dev

# --watch 付き。server/index.ts を保存すると読み直す
serve:
	bun run server

build:
	bun run build

# 型と組み立てが通るか。配置の前に必ず通す。
#
# **画面とサーバーを両方見る。** サーバーは長らく検査の外に居て、
# Player の宣言から 11 個のフィールドが抜けたまま動いていた
# (bun は型を剥がすだけなので気づけない)。厳しさは tsconfig.base.json に
# 1 つ置いて、両方がそれを継いでいる。
check:
	bunx tsc --noEmit -p tsconfig.app.json
	bunx tsc --noEmit -p tsconfig.server.json
	bunx tsc --noEmit -p tsconfig.test.json
	bun test
	bun run build

# 試験だけ。check の一部でもあるので、普段は check を叩けばよい。
#
# 単体 (src/sim/*.test.ts) は一瞬。統合 (test/) は 1 本ごとにサーバーを
# 立てて実時間を待つので 50 秒ほどかかる。
test:
	bun test

# --- 配置 -----------------------------------------------------------------

deploy: deploy-server deploy-web

# 接続先 (wss://mgohttp.pepaga.me) は .env.production からビルド時に焼かれる。
# 手元の開発には効かないので、開発中に本番へ繋がる事故は起きない。
deploy-web: check
	bunx wrangler pages deploy dist --project-name $(PAGES_PROJECT) --branch main --commit-dirty=true

# **origin から取り直す。** 手元の作業中のものを送らない —
# 送ると、動いているサーバーの中身がどのコミットか分からなくなる。
#
# .env は送らない。秘密なのでリポジトリに無く、最初の 1 回だけ手で置いてある。
deploy-server:
	$(SSH) 'cd $(SERVER_DIR) && git fetch -q origin && git reset -q --hard origin/main && ~/.bun/bin/bun install --frozen-lockfile'
	$(SSH) 'sudo systemctl restart mgohttp'
	@sleep 2
	@$(MAKE) --no-print-directory status

# --- 箱を仕立てる ---------------------------------------------------------
# 普段は使わない。インスタンスを作り直したときだけ。
#
# **ここに無いものは箱の上にしか無い。** 手で置いたまま記録が無いと、
# 作り直すときに思い出しながら書くことになる (実際そうなっていた)。
# 手順の詳細は deploy/README.md。

# 鍵を送る。**repo には入れない** (.gitignore)。何が要るかは .env.example。
#
# 送る前に中身を見せる。取り違えた .env を本番へ送るのがいちばん怖い。
push-env:
	@test -f .env || { echo '.env が無い。.env.example を写して埋める'; exit 1; }
	@echo '--- 送る中身 (値は伏せる) ---'
	@sed -E 's/=.*/=<値>/' .env
	@printf '送るか [y/N] '; read yes; test "$$yes" = y
	scp -i $(SERVER_KEY) .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_DIR)/.env
	$(SSH) 'chmod 600 $(SERVER_DIR)/.env'

# systemd と Caddy の設定を配る。中身は deploy/ にある (秘密は入っていない)
setup-server:
	scp -i $(SERVER_KEY) deploy/mgohttp.service $(SERVER_USER)@$(SERVER_HOST):/tmp/
	scp -i $(SERVER_KEY) deploy/Caddyfile $(SERVER_USER)@$(SERVER_HOST):/tmp/
	$(SSH) 'sudo install -m 644 /tmp/mgohttp.service /etc/systemd/system/mgohttp.service'
	$(SSH) 'sudo install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile'
	$(SSH) 'sudo systemctl daemon-reload && sudo systemctl enable --now mgohttp'
	$(SSH) 'sudo systemctl reload caddy || sudo systemctl restart caddy'
	@sleep 2
	@$(MAKE) --no-print-directory status

# --- 様子を見る -----------------------------------------------------------

status:
	@printf 'サーバー   '; curl -s -m 10 -o /dev/null -w '%{http_code}\n' https://mgohttp-server.pepaga.me/v1/health
	@printf 'クライアント '; curl -s -m 10 -o /dev/null -w '%{http_code}\n' https://mgohttp.pepaga.me/
	@printf '常駐       '; $(SSH) 'systemctl is-active mgohttp'
	@printf 'コミット   '; $(SSH) 'cd $(SERVER_DIR) && git log --oneline -1'

logs:
	$(SSH) 'sudo journalctl -u mgohttp -n 50 --no-pager'

ssh:
	$(SSH)

restart:
	$(SSH) 'sudo systemctl restart mgohttp'
	@sleep 2
	@$(MAKE) --no-print-directory status
