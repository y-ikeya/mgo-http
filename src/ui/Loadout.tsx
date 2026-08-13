import { For } from 'solid-js'
import { CHOICES, WEAPONS, type WeaponId } from '../sim/weapons'
import './Loadout.css'

/**
 * 装備を組む画面。
 *
 * 湧くときだけ開く。試合中に持ち物を組み替えられると、状況ごとに最適な物へ
 * 乗り換えるだけになって、選ぶこと自体が手にならない。
 * **戻って組み直すのに時間を払う**というのが元の作りだった。
 *
 * 枠は主・副・投擲の 3 段。今は副と投擲に選択肢が無いので、選べるのは主だけ。
 * それでも 3 段を出しているのは、持ち物の全体が一目で分かる形にしたいため。
 */
export default function Loadout(props: {
  primary: WeaponId
  onPrimary: (id: WeaponId) => void
  /** 反映されるまでの説明。死んでいる間か、開始前かで変わる */
  note: string
}) {
  const rows = () => [
    { key: 'PRIMARY', ids: CHOICES.primary, current: props.primary, pick: props.onPrimary },
    { key: 'SECONDARY', ids: CHOICES.secondary, current: 'pistol' as WeaponId, pick: () => {} },
  ]

  return (
    <div class="loadout">
      <div class="loadout-panel">
        <header class="loadout-head">
          <span class="loadout-title">LOADOUT</span>
          <span class="loadout-note">
            {props.note} · 1 / 2 で選ぶ · L で閉じる
          </span>
        </header>

        <For each={rows()}>
          {(row) => (
            <div class="loadout-row">
              <div class="loadout-slot">{row.key}</div>
              <div class="loadout-items">
                <For each={row.ids}>
                  {(id) => (
                    <button
                      class="loadout-item"
                      classList={{
                        'loadout-item-on': id === row.current,
                        'loadout-item-only': row.ids.length === 1,
                      }}
                      disabled={row.ids.length === 1}
                      onClick={() => row.pick(id)}
                    >
                      <span class="loadout-name">
                        {row.ids.length > 1 && (
                          <span class="loadout-key">{row.ids.indexOf(id) + 1}</span>
                        )}
                        {WEAPONS[id].kill}
                      </span>
                      <span class="loadout-spec">
                        {WEAPONS[id].magazine} + {WEAPONS[id].reserve}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>

        {/* 投擲は選ばせない。持ち物の全体が見える形にしたいので、表示だけする */}
        <div class="loadout-row">
          <div class="loadout-slot">SUPPORT</div>
          <div class="loadout-items">
            <button class="loadout-item loadout-item-on loadout-item-only" disabled>
              <span class="loadout-name">M26</span>
              <span class="loadout-spec">× 3</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
