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
  SKILL_BUDGET,
  costOf,
  type Skills,
} from '../../domain/player/skill'
import { SkillList } from './SkillPanel'
import './Loadout.css'

/**
 * 装備を組む画面。
 *
 * 支度をしている間だけ出る (domain/player/lifecycle.ts の choosing)。出す / 出さないは
 * サーバーが持つ状態がそのまま決めていて、こちらに開閉のフラグは無い。
 * フラグを持っていた頃は、閉じたまま開き直らない場面があった。
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
  /** その部屋で選べる主武器。**部屋が絞ることがある** (domain/match/room.ts) */
  primaries: readonly WeaponId[]
  /** 副武器。**null なら持たない** — 部屋が外している */
  secondary: WeaponId | null
  support: SupportId
  onPrimary: (id: WeaponId) => void
  /** 副武器を選んだ。**その部屋が持たせない場合は行が空になるので呼ばれない** */
  onSecondary: (id: WeaponId) => void
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
}) {
  /** その銃の予備弾 */
  const reserveOf = (id: WeaponId) => WEAPONS[id].reserve

  /** 表の並び順で出す。**予算の残りは段の合計から出る** */
  const spent = () => costOf(props.skills)

  /*
   * 枠は 2 つ。**副武器も選べる** — 麻酔銃 (M9) と殺傷 (M1911) に分かれた
   * ので、どちらを腰に提げるかが判断になった。
   *
   * 部屋が外していれば**行は残して中を空にする** (domain/match/room.ts の
   * secondary)。行ごと消すと枠そのものが無いように読めるが、実際には
   * 「その部屋では埋まらない枠」であって、無くなったわけではない。
   *
   * --- 配列は作り直さない ---
   * `rows()` の中で props を読んでいた頃、**状態が届くたび (10 回/秒) に新しい
   * 配列と新しいオブジェクト**ができ、For がボタンを丸ごと作り直していた。
   * 押し下げと離すの間にボタンが入れ替わるので、**click が成立しない** —
   * 数字キーでは選べるのにマウスでは選べない、という形で出た。
   *
   * 中身を関数で持って、配列そのものは動かさない。
   */
  const rows = [
    {
      key: 'PRIMARY',
      ids: () => props.primaries,
      current: () => props.primary,
      pick: (id: WeaponId) => props.onPrimary(id),
    },
    {
      key: 'SECONDARY',
      ids: () => (props.secondary === null ? [] : CHOICES.secondary),
      current: () => props.secondary ?? ('m9' as WeaponId),
      pick: (id: WeaponId) => props.onSecondary(id),
    },
  ]

  /*
   * 数字キーの番号。**行をまたいで続ける。**
   *
   * 主武器 1..n、副武器はその続き、投擲はさらに続き。行ごとに 1 から振ると
   * **同じ番号が 2 か所に出る** — 押した番号がどちらを指すのか読めない。
   * 番号を出しているのは押せるという意味なので、押せる番号と一致させる。
   *
   * 部屋が副武器を外していれば、その行は空なので投擲の番号が前へ詰まる
   * (scene/Game.ts の同じ計算と揃えてある)。
   */
  const keyBase = (row: (typeof rows)[number]) => {
    let base = 1
    for (const other of rows) {
      if (other === row) break
      base += other.ids().length
    }
    return base
  }

  return (
    <div class="loadout">
      <div class="loadout-panel">
        <header class="loadout-head">
          <span class="loadout-title">LOADOUT</span>
          <span class="loadout-note">
            {props.note} · 残り {props.left} 秒
          </span>
        </header>

        <For each={rows}>
          {(row) => (
            <div class="loadout-row">
              <div class="loadout-slot">{row.key}</div>
              <div class="loadout-items">
                <For each={row.ids()}>
                  {(id) => (
                    <button
                      class="loadout-item"
                      /*
                        殺傷か麻酔かで色を変える。**持ち替えの札 (HUD) と
                        同じ色**にしてあるので、選んだ物と手にある物が
                        同じ物だと色で繋がる。
                      */
                      classList={{
                        'loadout-item-on': id === row.current(),
                        'loadout-item-only': row.ids().length === 1,
                        'loadout-item-lethal': WEAPONS[id].tranquilizer !== true,
                        'loadout-item-tranq': WEAPONS[id].tranquilizer === true,
                      }}
                      disabled={row.ids().length === 1}
                      onClick={() => row.pick(id)}
                    >
                      <span class="loadout-name">
                        {row.ids().length > 1 && (
                          <span class="loadout-key">
                            {keyBase(row) + row.ids().indexOf(id)}
                          </span>
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
                    {/* 投擲は武器の続き番号。**副武器が無い部屋では前へ詰まる** */}
                    <span class="loadout-key">
                      {props.primaries.length +
                        (props.secondary === null ? 0 : CHOICES.secondary.length) +
                        1 +
                        i()}
                    </span>
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
          スキル。**ここでは見るだけ。** 変えるのは Tab の板 (ui/Scoreboard.tsx)。

          --- なぜ 1 か所にするか ---
          装備とスキルは選び直せる窓が違う — 装備は 1 つの命ごと、スキルは
          1 試合に 1 度 (domain/player/skill.ts の canChooseSkills)。同じ画面に
          並べると、同じ画面で押した 2 つが違うタイミングで効くことになって、
          いつ何が変わったのかが読めない。

          それでも並べておくのは、**装備を選ぶときに何が効いているかが要る**から。
          走る速さも散布も装填の速さもスキルで動くので、銃を選ぶ材料になる。
        */}
        <div class="loadout-row loadout-skills">
          <div class="loadout-slot">
            SKILL
            <div class="loadout-budget" classList={{ 'loadout-budget-full': spent() >= SKILL_BUDGET }}>
              {spent()} / {SKILL_BUDGET}
            </div>
            {/* 押せない物を並べるなら、どこで変えられるかも出す */}
            <div class="loadout-budget-locked">Tab から変更</div>
          </div>
          <div class="loadout-items">
            <SkillList skills={props.skills} open={false} onSkill={() => {}} />
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
