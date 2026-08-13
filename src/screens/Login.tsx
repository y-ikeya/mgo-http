import { createSignal, Show } from 'solid-js'
import { signIn, signUp, type Identity } from '../auth/session'
import './Login.css'

/**
 * 入り口。
 *
 * 登録を必須にしている。匿名で始められるほうが遊ぶまでは速いが、
 * それだとタブを開くたびに別人が増える — このゲームでは「誰が誰か」が
 * 味方との繋がりにも戦績にも効くので、最初に決めてもらう。
 */
export default function Login(props: { onDone: (identity: Identity) => void }) {
  const [name, setName] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [registering, setRegistering] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [notice, setNotice] = createSignal('')

  const submit = async (event: Event) => {
    event.preventDefault()
    if (busy()) return
    setError('')
    setNotice('')

    const who = name().trim()
    if (who.length < 2) return setError('名前は 2 文字以上にしてください')
    if (password().length < 6) return setError('パスワードは 6 文字以上にしてください')

    setBusy(true)
    try {
      const identity = registering()
        ? await signUp(who, password())
        : await signIn(who, password())

      // 登録したがメールの確認が要る設定だと、まだ入れない
      if (!identity) {
        setNotice('登録しました。確認メールのリンクを開いてから Login してください')
        setRegistering(false)
        return
      }
      props.onDone(identity)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Login できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="login">
      <form class="login-panel" onSubmit={submit}>
        <div class="login-title">MGOHTTP</div>
        <div class="login-sub">{registering() ? 'Sign up' : 'Login'}</div>

        <label class="login-field">
          <span>名前</span>
          <input
            type="text"
            autocomplete="username"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            disabled={busy()}
          />
        </label>

        <label class="login-field">
          <span>パスワード</span>
          <input
            type="password"
            autocomplete={registering() ? 'new-password' : 'current-password'}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            disabled={busy()}
          />
        </label>

        <Show when={error()}>
          <div class="login-error">{error()}</div>
        </Show>
        <Show when={notice()}>
          <div class="login-notice">{notice()}</div>
        </Show>

        <button class="login-submit" type="submit" disabled={busy()}>
          {busy() ? '…' : registering() ? 'Sign up' : 'Login'}
        </button>

        <button
          class="login-toggle"
          type="button"
          onClick={() => {
            setRegistering(!registering())
            setError('')
            setNotice('')
          }}
          disabled={busy()}
        >
          {registering() ? 'アカウントを持っている場合は Login' : 'アカウントを作る (Sign up)'}
        </button>
      </form>
    </div>
  )
}
