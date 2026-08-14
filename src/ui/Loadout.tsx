import { For } from 'solid-js'
import {
  CHOICES,
  SUPPORTS,
  SUPPORT_SPECS,
  WEAPONS,
  type SupportId,
  type WeaponId,
} from '../sim/weapons'
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
  support: SupportId
  onPrimary: (id: WeaponId) => void
  onSupport: (id: SupportId) => void
  /** 反映されるまでの説明。死んでいる間か、開始前かで変わる */
  note: string
  /** 自動で閉じるまで (秒) */
  left: number
  onClose: () => void
}) {
  /** その枠を選んだときの予備弾。弾倉を選ぶと 1 弾倉ぶん増える */
  const reserveOf = (id: WeaponId) =>
    WEAPONS[id].reserve + SUPPORT_SPECS[props.support].spareMagazines * WEAPONS[id].magazine

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
            {props.note} · 残り {props.left} 秒
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
                      {/*
                        予備弾は投擲の枠で変わる。表の値をそのまま出すと、
                        MAG を選んでも数字が動かず、増えていないように見える。
                      */}
                      <span class="loadout-spec">
                        {WEAPONS[id].magazine} + {reserveOf(id)}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>

        {/* 投擲。**どちらか一方**しか持てない */}
        <div class="loadout-row">
          <div class="loadout-slot">SUPPORT</div>
          <div class="loadout-items">
            <For each={SUPPORTS}>
              {(id, i) => (
                <button
                  class="loadout-item"
                  classList={{ 'loadout-item-on': id === props.support }}
                  onClick={() => props.onSupport(id)}
                >
                  <span class="loadout-name">
                    <span class="loadout-key">{i() + 3}</span>
                    {SUPPORT_SPECS[id].label}
                  </span>
                  <span class="loadout-spec">
                    × {SUPPORT_SPECS[id].count} · {SUPPORT_SPECS[id].hint}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>

        {/*
          決めるまで動けない。押して初めて操作が戻る、という手続きにしてある。
          後回しにして走り出せると「湧くときに決める」が有名無実になる。
        */}
        <button class="loadout-ok" onClick={props.onClose}>
          OK<span class="loadout-key loadout-key-wide">Enter</span>
        </button>
      </div>
    </div>
  )
}
