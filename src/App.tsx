import { createSignal, onMount, Show } from 'solid-js'
import { Route, Router, Navigate } from '@solidjs/router'
import { AUTH_READY, restore, type Identity } from './auth/session'
import { checkGpu } from './game/gpu'
import GpuBlocked from './ui/GpuBlocked'
import Login from './screens/Login'
import Lobby from './screens/Lobby'
import Play from './screens/Play'
import './App.css'

/**
 * 画面の出し分け。
 *
 *   /rooms         部屋の一覧
 *   /rooms/:room   対戦
 *
 * ログインしていなければ、どの経路でも入り口を出す。行き先を覚えたまま
 * 入り口を被せるだけなので、ログインしたらそのまま元の場所へ進む。
 */
export default function App() {
  const [identity, setIdentity] = createSignal<Identity | null>(null)
  const [checking, setChecking] = createSignal(AUTH_READY)

  // 前回の token が生きていれば入り直さない
  onMount(async () => {
    if (!AUTH_READY) return
    setIdentity(await restore())
    setChecking(false)
  })

  /**
   * 描ける機械か。**ログインより手前で見る。**
   *
   * 判定に通信は要らない (画面を 1 枚も描かずに、環境として分かる) ので、
   * 部屋に入る前どころか、名前を入れる前に止められる。直し方を出しても
   * 直さずに進める意味が無いので、逃げ道は置かない。
   */
  const gpu = checkGpu()

  return (
    <>
      <Show when={!gpu.ok}>
        <GpuBlocked verdict={gpu} />
      </Show>

      <Show when={gpu.ok && !AUTH_READY}>
        <div class="app-misconfigured">
          .env に VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY が要る
        </div>
      </Show>

      <Show when={gpu.ok && AUTH_READY && !checking() && !identity()}>
        <Login onDone={setIdentity} />
      </Show>

      <Show when={gpu.ok && identity()}>
        {(who) => (
          <Router>
            <Route path="/rooms" component={() => <Lobby identity={who()} />} />
            <Route path="/rooms/:room" component={() => <Play identity={who()} />} />
            {/*
              クエリを持ったまま飛ばす。`?server=` や `?panel=open` は
              この先で読まれるので、ここで落とすと効かない
              (手元の画面から本番のサーバーへ繋ぐ、ができなくなる)。
            */}
            <Route
              path="*"
              component={() => <Navigate href={`/rooms${location.search}`} />}
            />
          </Router>
        )}
      </Show>
    </>
  )
}
