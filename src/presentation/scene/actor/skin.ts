/**
 * 誰にどのモデルを着せるか。**試作**。
 *
 * 見た目の仕組み (players.appearance) が入るまでの繋ぎ。いまは表示名で引く。
 * 本番は id で引いて、DB が持つ appearance から組み立てることになる。
 *
 * --- 判定には触れない ---
 * 差し替えたのは頭だけで、頭の骨の位置も当たり球の半径も変えていない。
 * 体格が変わると遮蔽の判定 (stance.ts の HEAD_HEIGHT) と食い違って、
 * 「見えているのに撃てない」が出る。**見た目は幾何を変えない**という決めごとを
 * 試作の段階から守っておく。
 *
 * --- なぜ名前を作る側で持たないか ---
 * モデルの読み込みは Soldier / RemoteSoldier の構築時に始まる。名前は
 * 「作った直後に外から入れる」形なので、構築後に見に行くと**まだ空**。
 * ここで引いた結果を**構築の引数として渡す**ことで、その順序の問題を作らない。
 */

import type { Voice } from '../sense/audio'

/** 既定のモデル。public/models/<名前>.glb */
export const DEFAULT_SKIN = 'soldier'

/**
 * 練習の的の見た目。**人と見分けが付くように、Mixamo の X Bot** (本人 2026-10-16)。
 * 体は Raiden と同じ道で入れた (rebody → merge_all_clips → fit_height、頭の高さは宿主と同じ)
 */
export const TARGET_SKIN = 'soldier_xbot'

const SKINS: Record<string, string> = {
  /*
   * Raiden。体ごと差し替えてある。
   *
   * 骨は貼り替えず、**クリップだけを移した** (tools/rebody.py +
   * tools/merge_all_clips.js)。メッシュを別の骨に貼り直すとレストポーズの差が
   * そのまま歪みになるが、回転は体つきに依存しないので同じ角度で曲がる。
   *
   * 背丈は Armature の scale を宿主と揃えて合わせてある (tools/fit_height.js)。
   * **見た目の理由だけではない** — HEAD_HEIGHT = 1.47 は 1 体を実測した値なので、
   * 頭がずれた体を入れると、その人だけ見た目と判定が食い違う (見えている頭を
   * 撃つと胴に当たり、頭の上の空を撃つと頭に当たる)。
   *
   * 移したクリップは**宿主の単位で腰の高さを持っている**。scale がずれていると
   * その比のぶん腰が沈む — 素の姿勢では合っているのに動かすと低い、という形で出る。
   */
  pepa1404: 'soldier_raiden',
  /*
   * nanashi。Mixamo の Kachujin の体に、Tripo の頭を付け替えたもの (2026-11-10、
   * 元は tools/raw/bald_woman.blend、書き出しに使った写しは nanashi_kachujin.blend)。
   * Raiden と同じ道 (rebody --nohead → merge_all_clips → fit_height --hips → dedup → pack)。
   *
   * **型は前の名無しの glb から移した** (宿主から merge_clip で足した 100 本が揃っている)。
   * 頭と首の重みは Blender で塗ってあるので rebody は --nohead で通す。
   * 体が宿主より大きく (頭 1.572m)、fit_height で 0.85 倍に縮めた。**持ち上げずに型の腰の上下を
   * 1.15 倍にする (--hips)** — 持ち上げは型によらず一定なので、伏せると 12cm 浮いた
   */
  nanashi: 'soldier_nanashi',
  /*
   * kome27。Mixamo の MocapGuy (本人が落とした T-Pose.fbx → tools/raw/MocapGuy.fbx)。Raiden と同じ道
   * (rebody → merge_all_clips → fit_height、頭 1.4609m・爪先は宿主と同じ)。
   * **rebody は --nohead で通す** — T ポーズの腕が「顎から上」に入って頭の骨へ寄せられ、腕が翼のように伸びた
   */
  kome27: 'soldier_kome',
}

/**
 * 使っているモデルの一覧。**型が揃っているかを見張るのに要る** (skin.test.ts)。
 *
 * 表から出す。**別に並べると必ず片方が古くなる** — モデルを足したのに
 * 見張りに載せ忘れる、が起きる。
 */
export const SKIN_FILES: readonly string[] = [
  ...new Set([DEFAULT_SKIN, TARGET_SKIN, ...Object.values(SKINS)]),
]

/**
 * 体ごとの声 (倒れた叫び・うめきなど。sense/audio.ts の CRIES)。**載っていない体は男の声。**
 * 見た目と同じく名前から決まるので、誰の画面でも同じ声になる
 */
const VOICES: Readonly<Record<string, Voice>> = {
  soldier_nanashi: 'woman1',
}

export function voiceFor(skin: string): Voice {
  return VOICES[skin] ?? 'man1'
}

/** 的の id の頭 (server/world.ts の placeTargets が付ける) */
const TARGET_ID_PREFIX = 'target-'

/**
 * その人に着せるモデル。**的は id で見分ける** — 名前 (TARGET 1 …) は名簿が届くまで
 * 分からないが、id は姿の最初の 1 通から分かる
 */
export function skinFor(name: string | undefined, id?: string): string {
  if (id?.startsWith(TARGET_ID_PREFIX)) return TARGET_SKIN
  return (name && SKINS[name]) || DEFAULT_SKIN
}

/**
 * `?skin=soldier_raiden` で自分の見た目を上書きする。試作を見るためだけの物。
 *
 * **自分にしか効かない。** 他人の見た目はその人の名前から決まるので、
 * ここで何を指定しても相手の画面には出ない。見せかけて有利になる類の物でもない
 * (見た目は幾何を変えないと決めてある)。
 *
 * 名前の一致に頼らずに実物を見られるようにするために置いている。
 * appearance が入ったら消す。
 */
export function selfSkin(name: string | undefined): string {
  const asked = new URLSearchParams(location.search).get('skin')
  // 知らない名前を渡されて 404 を読みに行かないよう、表にある物だけ通す
  if (asked && SKIN_FILES.includes(asked)) {
    return asked
  }
  return skinFor(name)
}
