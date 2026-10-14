/**
 * 最初の画面 (対戦か練習か) を描く。
 *
 *     bunx vite  →  http://localhost:5173/tools/preview/home.html
 */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import Home from '../../src/presentation/screens/Home'

render(
  () => (
    <Router>
      <Route path="*" component={() => <Home identity={{ subject: 'me', displayName: 'YUMA', token: '' } as never} />} />
    </Router>
  ),
  document.getElementById('root')!,
)
