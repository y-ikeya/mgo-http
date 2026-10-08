import { createResource, Show } from 'solid-js'
import { t } from '../../i18n'
import { fetchTrainingRoom } from '../../infra/api/rooms'
import type { Identity } from '../../infra/auth/session'
import Play from './Play'
import './Lobby.css'

/**
 * 練習 (/training)。**自分だけの練習部屋へそのまま入る。**
 *
 * 入る部屋はサーバーに訊く (GET /training)。手元のサーバーなら検証場 (foxtrot、
 * 段・窓・梯子・的が揃っている)、公開しているサーバーは更地の練習場 (echo)。
 */
async function trainingRoom(): Promise<string> {
  try {
    return await fetchTrainingRoom()
  } catch {
    return 'echo'
  }
}

export default function Training(props: { identity: Identity }) {
  const [room] = createResource(trainingRoom)
  return (
    <Show
      when={room()}
      fallback={
        <div class="lobby">
          <div class="lobby-empty">{t('lobby.loading')}</div>
        </div>
      }
    >
      {(name) => <Play identity={props.identity} room={name()} />}
    </Show>
  )
}
