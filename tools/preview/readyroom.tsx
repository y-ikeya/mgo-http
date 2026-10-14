/**
 * 待合室 (試合前の支度) を描く。
 *
 *     bunx vite  →  http://localhost:5173/tools/preview/readyroom.html
 *     ?skill=knifeMastery   詳しく出す技 (パッドで指している扱い)
 *     ?ready                自分が READY 済み
 *     ?hold=0.5             長押しの途中
 */
import { render } from 'solid-js/web'
import ReadyRoom from '../../src/presentation/ui/ReadyRoom'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadSoldier } from '../../src/presentation/scene/assets'
import { buildLights } from '../../src/presentation/scene/world/stage'

const query = new URLSearchParams(location.search)
const ready = query.has('ready')

/*
 * ?game … 試合の描画器を後ろで回す (同じ兵士を描く)。本番では読んだ模型を
 * 試合の描画器と待合室の描画器が分け合うので、その形で兵士が出るかを見る
 */
if (query.has('game')) {
  const renderer = new WebGPURenderer({ antialias: true })
  renderer.setSize(400, 300)
  Object.assign(renderer.domElement.style, { position: 'fixed', right: '0', bottom: '0', zIndex: '99' })
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  buildLights(scene)
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 50)
  camera.position.set(0, 1, 4)
  const gltf = await loadSoldier(query.get('skin') ?? 'soldier')
  scene.add(cloneSkinned(gltf.scene))
  void renderer.setAnimationLoop(() => renderer.render(scene, camera))
  await new Promise((r) => setTimeout(r, Number(query.get('delay') ?? '1500')))
}

render(
  () => (
    <ReadyRoom
      skin={query.get('skin') ?? 'soldier'}
      gun="rifle"
      left={42}
      skills={{ runner: 2, knifeMastery: 3, rifleMastery: 1 }}
      skillsOpen={!ready}
      onSkill={() => {}}
      players={
        [
          { id: 'me', name: 'YUMA', team: 'red', ready, kills: 0, deaths: 0 },
          { id: 'b', name: 'pepa', team: 'blue', ready: true, kills: 0, deaths: 0 },
          { id: 'c', name: 'nanashi', team: 'blue', ready: false, kills: 0, deaths: 0, away: true },
        ] as never
      }
      selfId="me"
      onReady={() => {}}
      hold={Number(query.get('hold') ?? '0')}
      focus={(query.get('skill') ?? 'runner') as never}
    />
  ),
  document.getElementById('root')!,
)
