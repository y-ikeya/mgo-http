import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import Profile from '../ui/Profile'
import { profilesAvailable } from '../net/profile'
import { useLevels } from '../net/levels'
import { t } from '../i18n'
import { useNavigate } from '@solidjs/router'
import { fetchRooms } from '../net/rooms'
import type { MatchPhase, RoomSummary } from '../net/types'
import type { Identity } from '../auth/session'
import { signOut } from '../auth/session'
import './Lobby.css'

/**
 * 部屋の一覧。
 *
 * 部屋はサーバーが決まった数だけ持っていて、増えたり消えたりしない。
 * 変わるのは中身 (人数・段階・得点) だけ。
 *
 * 「誰かが立てて人を待つ」形にしなかったのは、人が少ないうちは空の部屋が
 * 並ぶだけの一覧になるから。数を絞って固定すれば、入った先に誰か居る確率が上がる。
 */

/** 一覧を取り直す間隔 (ms)。人の出入りに気づける程度で、叩きすぎない */
const POLL_MS = 2000

/** 段階の呼び名。引くたびに t() を通す (言語は起動時に決まっているので実質定数) */
const PHASE_LABEL: Record<MatchPhase, () => string> = {
  waiting: () => t('lobby.waiting'),
  countdown: () => t('lobby.countdown'),
  playing: () => t('lobby.playing'),
  over: () => t('lobby.over'),
}

export default function Lobby(props: { identity: Identity }) {
  const navigate = useNavigate()
  const [rooms, setRooms] = createSignal<RoomSummary[]>([])
  const [error, setError] = createSignal('')
  /** 戦績を開いている相手。null なら閉じている */
  const [opened, setOpened] = createSignal<{ id: string; name: string } | null>(null)
  // 札に出す Lv。入る前に「この部屋は強いのばかり」が読めるように
  const levelFor = useLevels(
    () => rooms().flatMap((room) => room.roster.map((who) => who.id)),
    props.identity,
  )

  const poll = async () => {
    try {
      setRooms(await fetchRooms())
      setError('')
    } catch {
      setError(t('lobby.unreachable'))
    }
  }

  onMount(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  const full = (room: RoomSummary) => room.players >= room.capacity

  /**
   * 部屋へ移るとき、クエリをそのまま持っていく。
   *
   * `?server=` や `?panel=open` は部屋に入ってから読まれるので、
   * ここで落とすと効かない (手元の画面から本番のサーバーへ繋ぐ、ができなくなる)。
   */
  const enter = (name: string) => navigate(`/rooms/${name}${location.search}`)

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

      <Show when={error()}>
        <div class="lobby-error">{error()}</div>
      </Show>

      <div class="lobby-rooms">
        <For each={rooms()}>
          {(room) => (
            <div class="room" classList={{ 'room-full': full(room), 'room-live': room.phase === 'playing' }}>
              {/*
                入るのはこのボタン。**名前の札は別のボタン**なので、行ごと
                1 つのボタンにはできない (button の中に button は置けない)。
              */}
              <button class="room-enter" disabled={full(room)} onClick={() => enter(room.name)}>
              <span class="room-name">{room.name}</span>

              <span class="room-count">
                <span class="room-count-now">{room.players}</span>
                <span class="room-count-max">/ {room.capacity}</span>
              </span>

              {/* 空き具合を棒で。数字を読む前に埋まり具合が分かる */}
              <span class="room-bar">
                <span class="room-bar-fill" style={{ width: `${(room.players / room.capacity) * 100}%` }} />
              </span>

              <span class="room-phase">{PHASE_LABEL[room.phase]()}</span>

              <Show when={room.phase === 'playing' || room.phase === 'over'}>
                <span class="room-score">
                  <span class="room-blue">{room.blue}</span>
                  <span class="room-dash">–</span>
                  <span class="room-red">{room.red}</span>
                </span>
              </Show>

              <Show when={room.remaining > 0}>
                <span class="room-time">
                  {Math.floor(room.remaining / 60)}:
                  {String(room.remaining % 60).padStart(2, '0')}
                </span>
              </Show>
              </button>

              {/*
                誰が居るか。**部屋は人数ではなく人で選ぶ。**
                押すとその人の通算が開く (戦績の設定が無い環境では押せない)
              */}
              <Show when={room.roster.length > 0}>
                <div class="room-players">
                  <For each={room.roster}>
                    {(who) => (
                      <button
                        class={`room-player room-player-${who.team}`}
                        disabled={!profilesAvailable}
                        onClick={() => setOpened({ id: who.id, name: who.name })}
                      >
                        <span class="room-player-lv">{levelFor(who.id)}</span>
                        {who.name}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={rooms().length === 0 && !error()}>
        <div class="lobby-empty">{t('lobby.loading')}</div>
      </Show>

      <Show when={opened()} keyed>
        {(who) => (
          <Profile
            subject={who.id}
            fallbackName={who.name}
            identity={props.identity}
            onClose={() => setOpened(null)}
          />
        )}
      </Show>
    </div>
  )
}
