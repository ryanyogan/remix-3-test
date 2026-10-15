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
      routes.dashboard.boards.index.href(),
    ]) {
      let response = await router.fetch(get(href))
      assert.equal(response.status, 303)
      assert.equal(response.headers.get('Location'), routes.login.index.href())
    }
  })

  it('renders the overview inside the layout with the user menu', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)

    let response = await router.fetch(get(routes.dashboard.index.href(), cookie))
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /<header/)
    assert.match(html, /popovertarget="user-menu"/)
    assert.match(html, /id="user-menu"[^>]*popover/)
    assert.match(html, /ada@example\.com/)
    assert.match(html, /href="\/dashboard"[^>]*aria-current="page"/)
    assert.doesNotMatch(html, /scrypt\$/)
  })

  it('links Account only from the user menu, not the header nav', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)

    let html = await (await router.fetch(get(routes.dashboard.index.href(), cookie))).text()
    let nav = html.match(/<nav aria-label="Dashboard"[\s\S]*?<\/nav>/)?.[0] ?? ''
    assert.match(nav, /Boards/)
    assert.doesNotMatch(nav, /Account/)
    let menu = html.match(/id="user-menu"[\s\S]*?<\/form>/)?.[0] ?? ''
    assert.match(menu, /href="\/dashboard\/account"/)
  })

  it('charts card progress across boards', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)

    let empty = await (await router.fetch(get(routes.dashboard.index.href(), cookie))).text()
    assert.match(empty, /No boards yet/)

    let body = new FormData()
    body.set('name', 'Launch')
    await router.fetch(
      new Request(new URL(routes.dashboard.boards.create.href(), origin), {
        method: 'POST',
        body,
        headers: { Cookie: cookie },
      }),
    )

    let html = await (await router.fetch(get(routes.dashboard.index.href(), cookie))).text()
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
    assert.match(html, /popovertarget="user-menu"/)
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
