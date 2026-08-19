// docs/weapons.md を書き出す。
//
//   bun tools/weapon_table.ts
//
// --- なぜ生成するか ---
// 数字の出どころは src/sim/weapons.ts で、そこはゲームが実際に読む所。手で表を
// 書くと**必ずずれる**。しかも気づけない — 表が古いことは、表を見ても分からない。
//
// --- 手で書く所と生成する所を分ける ---
// docs/weapons.md の**印より上は手で書く**。各武器の役どころや、なぜその数字なのか
// といった理由はそちらへ。印より下だけを毎回書き直す。
//
// 全部を生成すると理由が書けず、全部を手で書くと数字がずれる。
//
// --- なぜ生の値をそのまま出さないか ---
// 「HEAD 100 / minScale 0.5」を見ても強さが分からない。知りたいのは**何発で
// 死ぬか**で、それは減衰と体力を通して初めて出る。実際、拳銃が遠距離でも頭 2 発
// だったことは、表の数字を眺めていても分からず、発数に直して初めて見えた。

import {
  SUPPORT_SPECS, SUPPORTS, WEAPONS, bulletDamage, carrySpeedScale, weaponOf,
  type WeaponId,
} from '../src/sim/weapons'
import { MAX_HEALTH, MELEE_BACK_DAMAGE, MELEE_FRONT_DAMAGE, MELEE_RANGE } from '../src/sim/damage'
import { BLAST_DAMAGE, BLAST_RADIUS } from '../src/sim/blast'
import { BLAST_MAX, BLAST_MIN, BLAST_RANGE, TRIGGER_RANGE } from '../src/sim/claymore'

/** 何発当てれば倒せるか。0 なら何発でも倒せない */
function shots(damage: number): string {
  if (damage <= 0) return '—'
  return String(Math.ceil(MAX_HEALTH / damage))
}

/** その発数を撃ち終わるまでの時間。1 発目は 0 秒なので (n-1) 回ぶん待つ */
function ttk(spec: { fireInterval: number }, damage: number): string {
  if (damage <= 0) return '—'
  const n = Math.ceil(MAX_HEALTH / damage)
  return `${((n - 1) * spec.fireInterval).toFixed(2)}s`
}

const DISTANCES = [5, 10, 15, 20, 25, 30, 40, 60, 80]
const out: string[] = []
const w = (line = '') => out.push(line)

/** この印より下だけを書き直す。上は手で書いた説明が乗っている */
const MARKER = '<!-- ここから下は生成。bun tools/weapon_table.ts が書き直す -->'

w(MARKER)
w()
w('# 表')
w()
w(`体力は ${MAX_HEALTH}。「発」は倒すのに要る命中数、「時間」は撃ち終わるまで。`)
w()

for (const id of Object.keys(WEAPONS) as WeaponId[]) {
  const spec = WEAPONS[id]
  const scale = carrySpeedScale(spec)
  w(`## ${spec.kill} (\`${id}\`)`)
  w()
  w('| | |')
  w('|---|---|')
  w(`| 重さ | ${spec.weight}kg → 提げているときの速さ **${(scale * 100).toFixed(0)}%** |`)
  w(`| 弾倉 / 予備 | ${spec.magazine} / ${spec.reserve} |`)
  w(`| 連射 | ${spec.fireInterval}s 間隔${spec.auto ? ' (押しっぱなしで連射)' : ' (単発)'}${spec.bolt ? ' + ボルト操作' : ''} |`)
  w(`| リロード | ${spec.reload}s |`)
  w(`| 減衰 | ${spec.fullRange}m まで等倍、${spec.minRange}m から ${(spec.minScale * 100).toFixed(0)}% で頭打ち |`)
  w()
  w('| 距離 | HEAD | 発 | 時間 | BODY | 発 | 時間 | LEGS | 発 |')
  w('|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const d of DISTANCES) {
    const h = bulletDamage(spec, 'HEAD', d)
    const b = bulletDamage(spec, 'BODY', d)
    const l = bulletDamage(spec, 'LEGS', d)
    w(`| ${d}m | ${h.toFixed(0)} | ${shots(h)} | ${ttk(spec, h)} | ${b.toFixed(1)} | ${shots(b)} | ${ttk(spec, b)} | ${l.toFixed(1)} | ${shots(l)} |`)
  }
  w()
}

w('## 投げる物・置く物')
w()
w('| | 数 | 説明 |')
w('|---|---|---|')
for (const id of SUPPORTS) {
  const s = SUPPORT_SPECS[id]
  w(`| ${s.label} | ${s.count} | ${s.hint} |`)
}
w()
w('### 手榴弾の爆風')
w()
w(`爆心で **${BLAST_DAMAGE}**、届く距離 **${BLAST_RADIUS}m**。`)
w(`体力 ${MAX_HEALTH} なので**単体では死なない**。`)
w()
w('### クレイモアの爆風')
w()
w(`正面 **${TRIGGER_RANGE}m** で反応し、**${BLAST_RANGE}m** まで届く。`)
w(`至近 **${BLAST_MAX}** / 端 **${BLAST_MIN}**。こちらも単体では死なない。`)
w()
w('## 近接')
w()
w('| | ダメージ | |')
w('|---|---|---|')
w(`| 背後から | ${MELEE_BACK_DAMAGE} | 即死 |`)
w(`| 正面から | ${MELEE_FRONT_DAMAGE} | 2 回 |`)
w()
w(`間合いは ${MELEE_RANGE}m。`)
w()
w('---')
w()
w('## 読み方の注意')
w()
w('**減衰は部位で分けていない。** 1 つの倍率が HEAD にも BODY にも LEGS にも')
w('同じように掛かる。だから「頭だけ遠距離で弱くする」ができない — 胴も一緒に')
w('落ちる。頭の即死の射程を縮めると、胴で倒せる距離も一緒に縮む。')
w()
w('**下限 (minScale) は頭に対して効きにくい。** HEAD が体力ちょうど (100) の武器')
w('では、下限が 0.5 なら遠距離でも 50 = 2 発で倒せてしまう。距離を離しても')
w('「頭 2 発」が変わらないなら、それは減衰が効いていない。')

const path = new URL('../docs/weapons.md', import.meta.url).pathname

// 印より上を残す。
//
// **印が無いファイルには書き込まない。** 「印が無ければ全部生成物」にしていたら、
// 手で書いた説明を丸ごと消した。生成は上書きなので、判断を間違えたときの被害が
// 戻らない。無い物 (初回) だけ作る。
let head = ''
const file = Bun.file(path)
if (await file.exists()) {
  const existing = await file.text()
  const at = existing.indexOf(MARKER)
  if (at < 0) {
    console.error(`${path} に印が無い。手で書いた物を消しかねないので書き込まない。`)
    console.error(`書き直したいなら、残したい説明の末尾に次の行を置くこと:`)
    console.error(`  ${MARKER}`)
    process.exit(1)
  }
  head = existing.slice(0, at)
}

await Bun.write(path, head + out.join('\n') + '\n')
console.log(`書いた ${path} (生成部 ${out.length} 行 / 手書き ${head.split('\n').length - 1} 行)`)
