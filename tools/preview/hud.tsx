/**
 * HUD を**本物のまま**描く。作り物の stats を渡すだけで、3D も通信も動かさない。
 *
 *     bunx vite  →  http://localhost:5173/tools/preview/hud.html?case=boxed
 *
 * 見本を手書きの HTML で描いて確かめた気になり、説明の行がカードに重なっている
 * のを 1 度見落とした。以後はこの頁で確かめる。
 */
import { render } from 'solid-js/web'
import Hud from '../../src/ui/Hud'
import type { GameStats } from '../../src/game/Game'

const base = {
  stage: 'GARAGE', backend: 'webgpu', fps: 120, x: 0, z: 0, speed: 0,
  locked: true, shots: 0, ammo: 24, magazine: 30, reserve: 60,
  reloading: false, downed: false, aiming: false, spread: 1.2, crouching: false,
  hitZone: '', links: [], menuOpen: false, loadoutOpen: false, loadoutLeft: 0,
  loadoutWait: 0, scoped: false, equipped: 'rifle', zoom: '', canZoom: false,
  scores: [], health: 100, maxHealth: 100, dead: false, kills: [],
  throwables: 2, grenades: 3, browsing: null, held: 'rifle', weaponHeld: 'rifle',
  tool: 'none', toolInHand: false, browsingFamily: null, switching: false,
  support: 'grenade', team: 0, match: null, players: 1, sendRate: 64, peerRates: [],
  points: [],
  canPickUp: false,
} as unknown as GameStats

const cases: Record<string, Partial<GameStats>> = {
  normal: {},
  boxed: { held: 'box', tool: 'box', toolInHand: true },
  boxedPistol: { held: 'box', tool: 'box', toolInHand: true, weaponHeld: 'pistol', ammo: 10, magazine: 12, reserve: 48 },
  noneSelected: { tool: 'none', toolInHand: false },
  empty: { ammo: 0 },
  reloading: { ammo: 0, reloading: true },
  // 状態の行が出てもカードの大きさが変わらないこと
  pressR: { ammo: 0 },
  downed: { ammo: 12, downed: true },
  // 拾える物が近くにある
  pickup: { canPickUp: true },
  // 点の増減
  points: {
    points: [
      { label: 'KILL', delta: 3, at: Date.now() },
      { label: 'DEATH', delta: -2, at: Date.now() },
    ],
  },
  browsingTool: {
    browsingFamily: 'tool',
    tool: 'box',
    toolInHand: true,
    browsing: {
      items: [
        { id: 'box', n: null, loaded: null, mag: null },
        { id: 'none', n: null, loaded: null, mag: null },
      ],
      at: 0,
    },
  },
  browsing: {
    browsingFamily: 'weapon',
    browsing: {
      items: [
        { id: 'rifle', n: 84, loaded: 24, mag: 30 },
        { id: 'pistol', n: 58, loaded: 10, mag: 12 },
        { id: 'grenade', n: 3, loaded: null, mag: null },
        { id: 'knife', n: null, loaded: null, mag: null },
      ],
      at: 1,
    },
  },
}
const which = new URLSearchParams(location.search).get('case') ?? 'normal'
const stats = { ...base, ...cases[which] } as GameStats
render(() => <Hud stats={stats} selfId="me" />, document.getElementById('root')!)
