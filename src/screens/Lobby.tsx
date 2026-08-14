import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { serverHttpUrl } from '../net'
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

interface Room {
  name: string
  players: number
  capacity: number
  phase: 'waiting' | 'countdown' | 'playing' | 'over'
  blue: number
  red: number
  remaining: number
}

const PHASE_LABEL: Record<Room['phase'], string> = {
  waiting: '待機中',
  countdown: 'まもなく開始',
  playing: '対戦中',
  over: '結果表示',
}

export default function Lobby(props: { identity: Identity }) {
  const navigate = useNavigate()
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [error, setError] = createSignal('')

  const poll = async () => {
    try {
      const response = await fetch(`${serverHttpUrl()}/rooms`)
      if (!response.ok) throw new Error(String(response.status))
      setRooms((await response.json()) as Room[])
      setError('')
    } catch {
      setError('サーバーに繋がらない')
    }
  }

  onMount(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  const full = (room: Room) => room.players >= room.capacity

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
            <button
              class="room"
              classList={{ 'room-full': full(room), 'room-live': room.phase === 'playing' }}
              disabled={full(room)}
              onClick={() => enter(room.name)}
            >
              <span class="room-name">{room.name}</span>

              <span class="room-count">
                <span class="room-count-now">{room.players}</span>
                <span class="room-count-max">/ {room.capacity}</span>
              </span>

              {/* 空き具合を棒で。数字を読む前に埋まり具合が分かる */}
              <span class="room-bar">
                <span class="room-bar-fill" style={{ width: `${(room.players / room.capacity) * 100}%` }} />
              </span>

              <span class="room-phase">{PHASE_LABEL[room.phase]}</span>

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
          )}
        </For>
      </div>

      <Show when={rooms().length === 0 && !error()}>
        <div class="lobby-empty">読み込み中…</div>
      </Show>
    </div>
  )
}
