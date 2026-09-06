/**
 * 人を並べて、刻みが追いついているかを測る。
 *
 *     bun run tools/measure/load.ts 8
 *
 * **人が居ないと履歴が動かない**ので、64Hz で送る客を定員ぶん並べて回す。
 * 読むのは /health の 1 行目 (平均 / 最悪 / heap)。
 *
 * 手を入れる前と後で同じ数字を取るために置いてある。**測らずに速くしない** —
 * 履歴をリングバッファにしようとして測ったら、満席でも上限の 1% しか使って
 * いなかった。
 */
import { Client, startServer } from '../../test/server'

const N = Number(process.argv[2] ?? '8')
const server = await startServer()
const clients: Client[] = []
for (let i = 0; i < N; i++) {
  const angle = (i / N) * Math.PI * 2
  const c = await new Client(server, `load${i}`, [Math.cos(angle) * 8, 0, Math.sin(angle) * 8]).ready()
  c.live()
  clients.push(c)
}
await Bun.sleep(600)
for (const c of clients) c.send({ type: 'ready', ready: true })
// 湧いて動き出すまで
await Bun.sleep(4000)
// 全員を動かし続ける (止まっていると履歴が同じ値で埋まるだけ)
let t = 0
const move = setInterval(() => {
  t += 0.05
  clients.forEach((c, i) => {
    const a = (i / N) * Math.PI * 2 + t
    c.moveTo(Math.cos(a) * 8, 0, Math.sin(a) * 8)
  })
}, 16)
await Bun.sleep(12000)
clearInterval(move)
const text = await server.health()
console.log(`--- ${N} 人 ---`)
console.log(text.split('\n').slice(0, 2).join('\n'))
for (const c of clients) c.close()
server.stop()
