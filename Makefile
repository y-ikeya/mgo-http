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

.PHONY: help dev serve build deploy deploy-web deploy-server logs status ssh restart check

help:
	@echo '手元で動かす'
	@echo '  make check          型と組み立て (画面 + サーバー)'
	@echo '  make dev            画面 (vite)。サーバーは同じホストの 8787 を見る'
	@echo '  make serve          対戦サーバー。保存すると勝手に読み直す'
	@echo ''
	@echo '配置する'
	@echo '  make deploy         クライアントとサーバーを両方'
	@echo '  make deploy-web     クライアントだけ (Cloudflare Pages)'
	@echo '  make deploy-server  サーバーだけ (Lightsail)'
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
	bun run build

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
