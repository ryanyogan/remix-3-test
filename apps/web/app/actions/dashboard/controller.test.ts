import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '../../routes.ts'
import { createTestRouter, getResponseCookie, origin, signUp } from '../../../test/router.ts'

function get(href: string, cookie?: string) {
  return new Request(new URL(href, origin), { headers: cookie ? { Origin: origin, Cookie: cookie } : undefined })
}

describe('dashboard', () => {
  it('redirects anonymous visitors to login from every dashboard page', async () => {
    let { router } = await createTestRouter()

    for (let href of [
      routes.dashboard.index.href(),
      routes.dashboard.account.href(),
      routes.dashboard.insights.href(),
      routes.dashboard.boards.index.href(),
    ]) {
      let response = await router.fetch(get(href))
      assert.equal(response.status, 303)
      assert.equal(response.headers.get('Location'), routes.login.index.href())
    }
  })

  it('renders activity with the center jump navigation and creation actions', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let response = await router.fetch(get(routes.dashboard.index.href(), cookie))
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /<header class="dashboard-header"/)
    assert.match(html, /<button(?=[^>]*class="jump-trigger")(?=[^>]*aria-haspopup="dialog")/)
    assert.match(html, /aria-keyshortcuts="j"/)
    assert.match(html, /aria-label="Primary navigation"/)
    assert.match(html, /Add a card/)
    assert.match(html, /Add a board/)
    assert.match(html, /href="\/dashboard"[^>]*aria-current="page"/)
    assert.doesNotMatch(html, /scrypt\$/)
  })

  it('keeps account settings and logout accessible in the jump navigation', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let html = await (await router.fetch(get(routes.dashboard.index.href(), cookie))).text()
    assert.match(html, /Account settings/)
    assert.match(html, /action="\/logout"/)
    assert.match(html, /Ada Lovelace/)
  })

  it('charts card progress across boards', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)

    let empty = await (await router.fetch(get(routes.dashboard.index.href(), cookie))).text()
    assert.match(empty, /A fresh start/)

    let body = new FormData()
    body.set('name', 'Launch')
    await router.fetch(
      new Request(new URL(routes.dashboard.boards.create.href(), origin), {
        method: 'POST',
        body,
        headers: { Origin: origin, Cookie: cookie },
      }),
    )

    let html = await (await router.fetch(get(routes.dashboard.insights.href(), cookie))).text()
    assert.match(html, /Progress by board/)
    assert.match(html, />Launch</)
    assert.match(html, /0\/0 done/)
    assert.match(html, /View as table/)
  })

  it('renders the account page inside the same layout', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)

    let response = await router.fetch(get(routes.dashboard.account.href(), cookie))
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /aria-haspopup="dialog"/)
    assert.match(html, /Member since/)
  })

  it('logs out from the user menu', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)

    let logout = await router.fetch(
      new Request(new URL(routes.logout.href(), origin), {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie },
      }),
    )
    assert.equal(logout.status, 303)
    assert.equal(logout.headers.get('Location'), routes.login.index.href())

    let dashboard = await router.fetch(get(routes.dashboard.index.href(), cookie))
    assert.equal(dashboard.status, 303)
  })

  it('keeps every signed-in page out of shared caches', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let d = routes.dashboard
    for (let href of [d.index.href(), d.insights.href(), d.notifications.href(), d.account.href(), d.boards.index.href()]) {
      let response = await router.fetch(get(href, cookie))
      assert.equal(response.status, 200, href)
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store', href)
    }
  })

  it('sends a signed-out frame request to sign in instead of rendering login inside the frame', async () => {
    let { router } = await createTestRouter()
    let frame = await router.fetch(new Request(new URL(routes.dashboard.activity.href(), origin), {
      headers: { Accept: 'text/html', 'X-Remix-Frame': 'true' },
    }))
    assert.equal(frame.status, 401)
    assert.equal(frame.headers.get('Cache-Control'), 'private, no-store')
    let html = await frame.text()
    assert.match(html, /Sign in again/)
    assert.doesNotMatch(html, /type="password"/)

    let page = await router.fetch(get(routes.dashboard.activity.href()))
    assert.equal(page.status, 303)
  })

  it('revokes copies of the session and other sign-ins when logging out', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let login = new FormData()
    login.set('email', 'ada@example.com')
    login.set('password', 'correct horse')
    let other = getResponseCookie(await router.fetch(new Request(new URL(routes.login.action.href(), origin), { method: 'POST', body: login })), 'session')

    await router.fetch(new Request(new URL(routes.logout.href(), origin), { method: 'POST', headers: { Origin: origin, Cookie: cookie } }))

    // Cookie sessions keep their own state, so the cookie sent before logout is still well
    // signed; the bumped session version is what rejects it.
    assert.equal((await router.fetch(get(routes.dashboard.index.href(), cookie))).status, 303)
    assert.equal((await router.fetch(get(routes.dashboard.index.href(), other))).status, 303)

    let again = getResponseCookie(await router.fetch(new Request(new URL(routes.login.action.href(), origin), { method: 'POST', body: login })), 'session')
    assert.equal((await router.fetch(get(routes.dashboard.index.href(), again))).status, 200)
  })
})
