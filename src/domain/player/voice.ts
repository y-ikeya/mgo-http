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
  // woman1 = 女の声 (名無しの体) の版。本人が録った goodluck / matane / yoro / gome.mp3 (2026-11-11)
  { id: 'goodluck', label: '幸運を祈る', sound: 'voiceGoodLuck', woman1: { label: '幸運を', sound: 'voiceGoodLuckWoman' } },
  { id: 'matane', label: 'じゃ！またね！', sound: 'voiceMatane', woman1: { label: 'またね', sound: 'voiceMataneWoman' } },
  { id: 'sesshou', label: 'また無駄な殺生をしてしまった...', sound: 'voiceSesshou' },
  { id: 'shinukato', label: '痛ぁ...死ぬかと思った', sound: 'voiceShinukato' },
  { id: 'yolo', label: 'よろしくお願いします！', sound: 'voiceYolo', woman1: { label: 'よろしくお願いします', sound: 'voiceYoloWoman' } },
  { id: 'grenade', label: 'グッグレネード！', sound: 'voiceGrenade' },
  { id: 'stomach', label: 'うぅ...お腹痛い...', sound: 'voiceStomach' },
  { id: 'sumimasen', label: 'すみません', sound: 'voiceSumimasen', woman1: { label: 'ごめんなさい', sound: 'voiceSumimasenWoman' } },
  { id: 'nn', label: 'ん？', sound: 'voiceNn' },
] as const

export type VoiceId = (typeof VOICE_LINES)[number]['id']

/**
 * 2 段の選び方。T で分類 (1 挨拶 / 2 驚き / 3 煽り)、続けて番号でセリフ。
 * 分類が無いと 1 段で 5 個までしか置けず、増やすほど番号を覚えられなくなる
 */
export const VOICE_CATEGORIES = [
  { id: 'greet', label: '挨拶', lines: ['goodluck', 'matane', 'yolo', 'sumimasen'] },
  { id: 'surprise', label: '驚き', lines: ['shinukato', 'grenade', 'nn'] },
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

/**
 * 自分の声の選び。**喋り方 (style) と高さ (pitch) の 2 つ。**
 *
 * 体から出る声 (倒れた叫び・うめき・定型文) を、本人が変えられるようにする
 * ための置き場所。装備と同じく「本人が選ぶ物」なので domain に置く —
 * 申告は信用せず、サーバーが fitVoice で丸めてから名簿で配る想定。
 *
 * ここに置くのは**鍵と数だけ**。どの音源でどう鳴らすか (録り音の表・
 * ピッチの掛け方) は presentation (scene/sense/audio.ts の CRIES) が持ち、
 * style の文字列だけが両者を繋ぐ。性別は別に持たない — style が声の主
 * (録り手) を兼ねるので、「女声で低め」のような組み合わせも矛盾なく表せる。
 *
 * 配線: 申告は装備の便 (loadout) に相乗りし、サーバーが fitVoice で丸めて
 * Player.voice に載せ、名簿で全員に配る。再生側は「選んだ声 ?? 体の声」で
 * 解決し、pitch を録り音の rate に重ねる。
 */

/** 喋り方。いまは男の声と女の声の 2 種 (録り音は presentation の CRIES が持つ) */
export const VOICE_STYLES = ['man1', 'woman1'] as const

export type VoiceStyle = (typeof VOICE_STYLES)[number]

/** 選んでいない・知らない style の時の喋り方 */
export const DEFAULT_VOICE_STYLE: VoiceStyle = 'man1'

/** 声の高さの範囲。UI のつまみもサーバーの丸めも、この同じ値を見る */
export const VOICE_PITCH_MIN = 0.8
export const VOICE_PITCH_MAX = 1.25

/** 高さを選んでいない時の値 (録り音そのまま) */
export const DEFAULT_VOICE_PITCH = 1

export interface VoiceChoice {
  style: VoiceStyle
  /** 録り音に重ねる高さの倍率 (VOICE_PITCH_MIN〜VOICE_PITCH_MAX) */
  pitch: number
}

/** 何も選んでいない人の声 */
export const DEFAULT_VOICE: VoiceChoice = { style: DEFAULT_VOICE_STYLE, pitch: DEFAULT_VOICE_PITCH }

/**
 * 声の申告を丸める (fitLoadout と同じ役)。
 *
 * 知らない style は既定へ、高さは数でなければ既定・範囲の外なら端へ。
 * 古い相手の申告や、手で組んだ申告が届いても壊れないようにするための関門で、
 * 丸めた結果だけが名簿に載る。
 */
export function fitVoice(input: { style?: unknown; pitch?: unknown } | null | undefined): VoiceChoice {
  const style = VOICE_STYLES.find((s) => s === input?.style) ?? DEFAULT_VOICE_STYLE
  const raw = input?.pitch
  const pitch =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(VOICE_PITCH_MAX, Math.max(VOICE_PITCH_MIN, raw))
      : DEFAULT_VOICE_PITCH
  return { style, pitch }
}

/**
 * その声の主が言う台詞 (文言と音)。**声の主ごとの版が無ければ男の版** (いまは挨拶の 4 つに女の版がある)。
 * 声の主 (VoiceStyle) は、本人が選んだ声があればそれ、無ければ体で決まる (presentation の skin.ts の voiceFor)
 */
export function spokenLine(id: string, voice: VoiceStyle): { label: string; sound: string } | null {
  const line = voiceLine(id)
  if (!line) return null
  const own = voice === 'woman1' && 'woman1' in line ? line.woman1 : null
  return own ?? { label: line.label, sound: line.sound }
}
