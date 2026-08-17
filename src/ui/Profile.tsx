import { createResource, Show } from 'solid-js'
import { fetchTotals } from '../net/profile'
import { levelOf, levelProgress, pointsForLevel, pointsOf } from '../sim/scoring'
import type { Identity } from '../auth/session'
import './Profile.css'

/**
 * 積み上がった戦績。部屋一覧で名前を押すと開く。
 *
 * --- なぜ部屋一覧から開くか ---
 * **部屋は人数ではなく「誰が居るか」で選ぶ。** 空き数を見るより、
 * 「この部屋は強いのばかり」「知り合いが居る」が分かるほうが効く。
 * 戦績を見たくなる場面がまさにそこなので、導線をそこに置く。
 *
 * --- 点は出さない ---
 * 通算の点は**試合数に比例して増えるだけ**で、上手さを表さない。
 * 点が意味を持つのは 1 試合の中の勝ち負けを決めるときで、そこは成績表が持つ。
 * ここに置くのは、積み上がって意味のある数と、比 (K/D) だけ。
 */
export default function Profile(props: {
  /** 発行元での識別子。部屋一覧が配っている id */
  subject: string
  /** 一覧に出ていた名前。読み込み中と、まだ記録が無いときに使う */
  fallbackName: string
  identity: Identity
  onClose: () => void
}) {
  const [totals] = createResource(
    () => props.subject,
    (subject) => fetchTotals(subject, props.identity),
  )

  const ratio = (t: { kills: number; deaths: number }) =>
    t.deaths === 0 ? t.kills.toFixed(2) : (t.kills / t.deaths).toFixed(2)

  return (
    <div class="profile-veil" onClick={props.onClose}>
      {/* 中を押しても閉じない。閉じるのは外側と × だけ */}
      <div class="profile" onClick={(event) => event.stopPropagation()}>
        <header class="profile-head">
          <span class="profile-name">{totals()?.name || props.fallbackName}</span>
          <button class="profile-close" onClick={props.onClose} aria-label="閉じる">
            ×
          </button>
        </header>

        <Show when={totals.loading}>
          <div class="profile-note">読み込み中…</div>
        </Show>

        <Show when={totals.error}>
          <div class="profile-note">戦績を読めなかった</div>
        </Show>

        <Show when={!totals.loading && !totals.error && !totals()}>
          {/* 行はサーバーが試合の終わりに初めて作る */}
          <div class="profile-note">まだ記録がない</div>
        </Show>

        <Show when={totals()} keyed>
          {(t) => {
            const points = pointsOf(t)
            const level = levelOf(points)
            return (
              <>
                <div class="profile-level">
                  <div class="profile-level-value">
                    <span class="profile-level-label">Lv</span>
                    {level}
                  </div>
                  {/* 次の Lv までの帯。数字だけだと「あとどれくらい」が読めない */}
                  <div class="profile-level-bar">
                    <span style={{ width: `${levelProgress(points) * 100}%` }} />
                  </div>
                  <div class="profile-level-note">
                    {points} pt / 次まで {Math.max(0, pointsForLevel(level + 1) - points)}
                  </div>
                </div>

                <dl class="profile-grid">
                  <div class="profile-cell">
                    <dt>試合</dt>
                    <dd>{t.matches}</dd>
                  </div>
                  <div class="profile-cell">
                    <dt>キル</dt>
                    <dd>{t.kills}</dd>
                  </div>
                  <div class="profile-cell">
                    <dt>デス</dt>
                    <dd>{t.deaths}</dd>
                  </div>
                  <div class="profile-cell">
                    <dt>K/D</dt>
                    <dd>{ratio(t)}</dd>
                  </div>
                  {/* 与えたヘッドショットと、受けたヘッドショット。
                      MGO2 はやられた側も記録していた — 上手さだけでなく
                      「どうやられたか」を見せるため */}
                  <div class="profile-cell">
                    <dt>ヘッドショット</dt>
                    <dd>{t.headshots}</dd>
                  </div>
                  <div class="profile-cell">
                    <dt>被ヘッドショット</dt>
                    <dd class="profile-bad">{t.headDeaths}</dd>
                  </div>
                  <div class="profile-cell">
                    <dt>自死</dt>
                    <dd class="profile-bad">{t.suicides}</dd>
                  </div>
                  {/* 途中で抜けた回数。リロードは数えない */}
                  <div class="profile-cell">
                    <dt>離脱</dt>
                    <dd class="profile-bad">{t.abandons}</dd>
                  </div>
                </dl>
              </>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
