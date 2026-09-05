import { For } from 'solid-js'
import { SKILLS, SKILL_BUDGET, costOf, type SkillId, type Skills } from '../../domain/player/skill'
import './SkillPanel.css'

/**
 * スキルの一覧。**装備画面と対戦表の両方が使う。**
 *
 * --- なぜ 2 か所から呼ぶか ---
 * 装備画面は湧く前に選ぶ場所、対戦表は試合中に**いま何を付けているかを見る**
 * 場所。同じ物を 2 か所に書くと、段の値段や押せるかどうかの出し方が片方だけ
 * 古くなる。ここに置いてあるのは並びと押せるかどうかだけで、**枠や見出しは
 * 呼ぶ側が持つ** — 装備画面は左に枠名の付いた行、対戦表は札の下の板と、
 * 入る場所の形が違う。
 *
 * --- 開いているか閉じているかは呼ぶ側が決める ---
 * 「いつ組み替えてよいか」はドメインルール (domain/player/skill.ts の
 * canChooseSkills)。ここはその答えを受け取って、押せる / 押せないを描くだけ。
 */
export function SkillList(props: {
  skills: Skills
  /** 組み替えてよいか。false なら見るだけ */
  open: boolean
  onSkill: (id: SkillId, level: number) => void
  /**
   * パッドと矢印キーで指している技。**装備画面だけが渡す。**
   *
   * 対戦表は読むだけの場所なので渡さない (印を出しても押せない)。
   */
  focus?: string
}) {
  const skillList = Object.values(SKILLS)
  const spent = () => costOf(props.skills)

  return (
    <For each={skillList}>
      {(spec) => {
        const level = () => props.skills[spec.id] ?? 0
        return (
          <div
            class="skill"
            classList={{ 'skill-on': level() > 0, 'skill-focus': props.focus === spec.id }}
          >
            <span class="skill-name">{spec.label}</span>
            <div class="skill-levels">
              <For each={[1, 2, 3] as const}>
                {(n) => (
                  <button
                    class="skill-level"
                    classList={{ 'skill-level-on': level() >= n }}
                    /*
                      その段にできないなら押せない。**いま入っている分を
                      返してから**考えるので、Lv2 から Lv3 は差額 1 で足りる。
                    */
                    disabled={!props.open || spent() - level() + n > SKILL_BUDGET}
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
  )
}
