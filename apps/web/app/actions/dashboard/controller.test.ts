import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '../../routes.ts'
import { createTestRouter, origin, signUp } from '../../../test/router.ts'

function get(href: string, cookie?: string) {
  return new Request(new URL(href, origin), { headers: cookie ? { Cookie: cookie } : undefined })
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
        headers: { Cookie: cookie },
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
        headers: { Cookie: cookie },
      }),
    )
    assert.equal(logout.status, 303)
    assert.equal(logout.headers.get('Location'), routes.login.index.href())

    let dashboard = await router.fetch(get(routes.dashboard.index.href(), cookie))
    assert.equal(dashboard.status, 303)
  })
})
