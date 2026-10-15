import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '../../routes.ts'
import { createTestRouter, getResponseCookie, origin, signUp } from '../../../test/router.ts'

function loginRequest(fields: Record<string, string>, cookie?: string) {
  let body = new FormData()
  for (let [name, value] of Object.entries(fields)) body.set(name, value)

  return new Request(new URL(routes.login.action.href(), origin), {
    method: 'POST',
    body,
    headers: cookie ? { Cookie: cookie } : undefined,
  })
}

describe('login', () => {
  it('renders the login form with a link to signup', async () => {
    let { router } = await createTestRouter()
    let response = await router.fetch(new URL(routes.login.index.href(), origin))

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /name="password"/)
    assert.match(html, /href="\/signup"/)
  })

  it('redirects a signed-in user to the dashboard', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let response = await router.fetch(
      new Request(new URL(routes.login.index.href(), origin), { headers: { Cookie: cookie } }),
    )

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.dashboard.index.href())
  })

  it('signs in with the right password, case-insensitive email', async () => {
    let { router } = await createTestRouter()
    await signUp(router)

    let response = await router.fetch(
      loginRequest({ email: ' ADA@example.com ', password: 'correct horse' }),
    )
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.dashboard.index.href())

    let cookie = getResponseCookie(response, 'session')
    let dashboard = await router.fetch(
      new Request(new URL(routes.dashboard.index.href(), origin), { headers: { Cookie: cookie } }),
    )
    assert.equal(dashboard.status, 200)
  })

  it('rejects a wrong password and an unknown email the same way', async () => {
    let { router } = await createTestRouter()
    await signUp(router)

    for (let fields of [
      { email: 'ada@example.com', password: 'wrong horse' },
      { email: 'nobody@example.com', password: 'correct horse' },
    ]) {
      let response = await router.fetch(loginRequest(fields))
      assert.equal(response.status, 401)
      let html = await response.text()
      assert.match(html, /Incorrect email or password/)
      assert.match(html, new RegExp(`value="${fields.email}"`))
      assert.doesNotMatch(html, new RegExp(`value="${fields.password}"`))
      assert.equal(response.headers.getSetCookie().length, 0)
    }
  })

  it('re-renders with field errors on invalid input', async () => {
    let { router } = await createTestRouter()
    let response = await router.fetch(loginRequest({ email: 'nope', password: '' }))

    assert.equal(response.status, 400)
    assert.match(await response.text(), /id="login-email-error"/)
  })
})
