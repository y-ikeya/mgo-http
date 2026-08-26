import { For } from 'solid-js'
import { t } from '../../i18n'
import {
  CHOICES,
  SUPPORTS,
  SUPPORT_SPECS,
  WEAPONS,
  type SupportId,
  type WeaponId,
} from '../../domain/item/weapons'
import {
  SKILLS,
  SKILL_BUDGET,
  costOf,
  type SkillId,
  type Skills,
} from '../../domain/player/skill'
import './Loadout.css'

/**
 * 装備を組む画面。
 *
 * 支度をしている間だけ出る (domain/player/lifecycle.ts の choosing)。出す / 出さないは
 * サーバーが持つ状態がそのまま決めていて、こちらに開閉の札は無い。
 * 札を持っていた頃は、閉じたまま開き直らない場面があった。
 *
 * 試合中に持ち物を組み替えられると、状況ごとに最適な物へ
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
  /** 放っておいても湧かされるまで (秒) */
  left: number
  /** OK が効くようになるまで (秒)。0 なら押せる */
  wait: number
  onSpawn: () => void
  /** いま効いているスキル。**サーバーが返した物** */
  skills: Skills
  /** 選び直せるか。試合が始まったら閉じる */
  skillsOpen: boolean
  onSkill: (id: SkillId, level: number) => void
}) {
  /** その銃の予備弾 */
  const reserveOf = (id: WeaponId) => WEAPONS[id].reserve

  /** 表の並び順で出す。**予算の残りは段の合計から出る** */
  const skillList = Object.values(SKILLS)
  const spent = () => costOf(props.skills)

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
                    {/* 主武器の続きの番号。挺数から出す (直に書くと重なる) */}
                    <span class="loadout-key">{CHOICES.primary.length + 1 + i()}</span>
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
          スキル。**装備とは選び直せる窓が違う** — 装備は 1 つの命ごと、
          スキルは 1 試合に 1 度 (domain/player/skill.ts の canChooseSkills)。

          段がそのまま値段なので、予算の残りを見せるだけで「何を諦めるか」が
          読める。押せない段を薄くするのではなく **disabled で触れなくする** —
          押しても何も起きない物を残すと、弾かれたのか壊れているのか分からない。
        */}
        <div class="loadout-row loadout-skills">
          <div class="loadout-slot">
            SKILL
            <div class="loadout-budget" classList={{ 'loadout-budget-full': spent() >= SKILL_BUDGET }}>
              {spent()} / {SKILL_BUDGET}
            </div>
            {/*
              閉じているなら理由を出す。**押せない物を並べるなら、なぜかも要る** —
              途中参加した人には最初から閉じているので、壊れているように見える
            */}
            {!props.skillsOpen && <div class="loadout-budget-locked">試合中は変更不可</div>}
          </div>
          <div class="loadout-items">
            <For each={skillList}>
              {(spec) => {
                const level = () => props.skills[spec.id] ?? 0
                return (
                  <div class="loadout-skill" classList={{ 'loadout-skill-on': level() > 0 }}>
                    <span class="loadout-skill-name">{spec.label}</span>
                    <div class="loadout-levels">
                      <For each={[1, 2, 3] as const}>
                        {(n) => (
                          <button
                            class="loadout-level"
                            classList={{ 'loadout-level-on': level() >= n }}
                            /*
                              その段にできないなら押せない。**いま入っている分を
                              返してから**考えるので、Lv2 から Lv3 は差額 1 で足りる。
                            */
                            disabled={!props.skillsOpen || spent() - level() + n > SKILL_BUDGET}
                            title={spec.hint}
                            onClick={() => props.onSkill(spec.id, level() === n ? 0 : n)}
                          >
                            {n}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </div>

        {/*
          押して初めて戦場へ出る。閉じるボタンではない。

          湧く時刻を本人に握らせている。自動で湧かせていた頃は、選んでいる
          途中で湧いて画面が消えていた。ただし早く押したぶん早く戻れる、には
          しない — 倒された直後に戻ってこられると、勝った側が休めない。
        */}
        <button class="loadout-ok" disabled={props.wait > 0} onClick={props.onSpawn}>
          {props.wait > 0 ? t('loadout.deployIn', { n: props.wait }) : 'OK'}
          <span class="loadout-key loadout-key-wide">Enter</span>
        </button>
      </div>
    </div>
  )
}
