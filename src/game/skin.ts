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
 * モデルの読み込みは Player / RemotePlayer の構築時に始まる。名前は
 * 「作った直後に外から入れる」形なので、構築後に見に行くと**まだ空**。
 * ここで引いた結果を**構築の引数として渡す**ことで、その順序の問題を作らない。
 */

/** 既定のモデル。public/models/<名前>.glb */
export const DEFAULT_SKIN = 'soldier'

const SKINS: Record<string, string> = {
  // Ch23 (Mixamo) の頭と髪を Ch35 の体に移植したもの。
  // tools/graft-head.py が作る
  pepa1404: 'soldier_pepa',
}

export function skinFor(name: string | undefined): string {
  return (name && SKINS[name]) || DEFAULT_SKIN
}

/**
 * `?skin=soldier_pepa` で自分の見た目を上書きする。試作を見るためだけの物。
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
  if (asked && (asked === DEFAULT_SKIN || Object.values(SKINS).includes(asked))) {
    return asked
  }
  return skinFor(name)
}
