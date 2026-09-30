/**
 * 定型文のボイス。
 *
 * MGO2 の VOICE (「頼む」「すまない」「幸運を」「やったな」) と同じ物。番号で選び、
 * **部屋の全員に、距離に関係なく**届く。無線という建前で、聞こえる範囲の
 * 規則 (rule/noise.ts) には乗せない。誰が言ったかはキルログと同じ欄に
 * 「名前：セリフ」で出る。
 *
 * 音の実体は public/audio/voice_◯◯1.mp3 (presentation/scene/sense/audio.ts の表)。
 */
export const VOICE_LINES = [
  { id: 'goodluck', label: '幸運を祈る', sound: 'voiceGoodLuck' },
  { id: 'matane', label: 'じゃ！またね！', sound: 'voiceMatane' },
  { id: 'sesshou', label: 'また無駄な折衝をしてしまった...', sound: 'voiceSesshou' },
  { id: 'shinukato', label: '痛ぁ...死ぬかと思った', sound: 'voiceShinukato' },
  { id: 'yolo', label: 'よろしくお願いします！', sound: 'voiceYolo' },
  { id: 'grenade', label: 'グッグレネード！', sound: 'voiceGrenade' },
  { id: 'stomach', label: 'うぅ...お腹痛い...', sound: 'voiceStomach' },
  { id: 'sumimasen', label: 'すみません', sound: 'voiceSumimasen' },
] as const

export type VoiceId = (typeof VOICE_LINES)[number]['id']

/**
 * 2 段の選び方。T で分類 (1 挨拶 / 2 驚き / 3 煽り)、続けて番号でセリフ。
 * 分類が無いと 1 段で 5 個までしか置けず、増やすほど番号を覚えられなくなる
 */
export const VOICE_CATEGORIES = [
  { id: 'greet', label: '挨拶', lines: ['goodluck', 'matane', 'yolo', 'sumimasen'] },
  { id: 'surprise', label: '驚き', lines: ['shinukato', 'grenade'] },
  { id: 'taunt', label: '煽り', lines: ['sesshou'] },
  { id: 'other', label: 'その他', lines: ['stomach'] },
] as const satisfies readonly { id: string; label: string; lines: readonly VoiceId[] }[]

/** 同じ人が続けて言える間隔 (秒)。連打は通す (前の声は途中で止まる) が、同じ刻みの二重送りだけ弾く */
export const VOICE_COOLDOWN = 0.25

/** 番号 (T のあとの 1〜5) を出してから、選ぶのを待つ秒数 */
export const VOICE_MENU_SECONDS = 3

export function voiceLine(id: string): (typeof VOICE_LINES)[number] | null {
  return VOICE_LINES.find((line) => line.id === id) ?? null
}
