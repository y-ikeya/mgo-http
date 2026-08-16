import { serverHttpUrl } from './index'
import type { RoomSummary } from './types'

/**
 * 部屋の一覧を取りに行く。
 *
 * --- なぜ画面から直に fetch しないか ---
 * 直に叩いていた頃は、画面の側が受け取る形を**手で書き写した interface** で
 * 受けて `as` で押し込んでいた。サーバーが返す形とは別の宣言なので、
 * 片方を変えればもう片方は静かに undefined を読む。
 *
 * 形の宣言は src/net/types.ts に 1 つだけ置いて、サーバーは satisfies で
 * 名乗り、こちらはそれを読む。
 *
 * --- `as` が 1 つ残っていること ---
 * 実行時には何も確かめていない。届いた JSON が本当にその形かは、型では
 * 保証できない (Hono の RPC でも同じ)。古いサーバーに繋げば古い形が来る。
 * **確かめるならここに 1 か所だけ足せばよい**、という状態にしてある。
 */
export async function fetchRooms(signal?: AbortSignal): Promise<RoomSummary[]> {
  const response = await fetch(`${serverHttpUrl()}/rooms`, { signal })
  if (!response.ok) throw new Error(`rooms ${response.status}`)
  return (await response.json()) as RoomSummary[]
}
