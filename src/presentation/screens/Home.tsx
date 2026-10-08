import { createSignal, onMount, Show } from 'solid-js'
import { useLocation, useNavigate } from '@solidjs/router'
import { t } from '../../i18n'
import type { Identity } from '../../infra/auth/session'
import { signOut } from '../../infra/auth/session'
import './Lobby.css'
import './Home.css'

/**
 * 最初の画面。**対戦か練習かを選ぶ** (2026-10-08 本人)。
 *
 *   対戦 → /rooms (部屋の一覧)
 *   練習 → /training (練習の部屋へそのまま入る。一覧を通らない)
 *
 * ログインの直後に部屋の一覧を出すと、動きを試したいだけの人も対戦の部屋を
 * 選ぶことになる。先に目的で分ける。
 */
export default function Home(props: { identity: Identity }) {
  const navigate = useNavigate()
  /*
   * 部屋から戻された理由 (認証が切れた)。**一度だけ出す** — 遷移の状態は履歴に
   * 残るので、読んだら消す (Lobby と同じ扱い)。押しても消える
   */
  const route = useLocation<{ notice?: string }>()
  const [notice, setNotice] = createSignal(route.state?.notice === 'expired' ? t('lobby.expired') : '')
  onMount(() => {
    if (route.state?.notice) window.history.replaceState(null, '')
  })
  // クエリは持って行く (?server= などは先で読まれる。Lobby の enter と同じ)
  const go = (path: string) => navigate(`${path}${location.search}`)

  return (
    <div class="lobby">
      <header class="lobby-head">
        <div class="lobby-title">MGOHTTP</div>
        <div class="lobby-who">
          {props.identity.displayName}
          <button
            class="lobby-signout"
            onClick={() => {
              signOut()
              location.reload()
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <Show when={notice()}>
        <div class="lobby-error" onClick={() => setNotice('')} title="OK">
          {notice()}
        </div>
      </Show>

      <div class="home-modes">
        <button class="home-mode" onClick={() => go('/rooms')}>
          <span class="home-mode-label">{t('home.versus')}</span>
          <span class="home-mode-hint">{t('home.versusHint')}</span>
        </button>
        <button class="home-mode" onClick={() => go('/training')}>
          <span class="home-mode-label">{t('home.training')}</span>
          <span class="home-mode-hint">{t('home.trainingHint')}</span>
        </button>
      </div>
    </div>
  )
}
