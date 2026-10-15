import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { verifyPassword } from '../../data/passwords.ts'
import { users } from '../../data/tables.ts'
import { routes } from '../../routes.ts'
import { createTestRouter, getResponseCookie, origin } from '../../../test/router.ts'

function signupRequest(fields: Record<string, string>, cookie?: string) {
  let body = new FormData()
  for (let [name, value] of Object.entries(fields)) body.set(name, value)

  return new Request(new URL(routes.signup.action.href(), origin), {
    method: 'POST',
    body,
    headers: cookie ? { Cookie: cookie } : undefined,
  })
}

const validFields = {
  name: ' Ada Lovelace ',
  email: ' Ada@Example.com ',
  password: 'correct horse',
}

describe('signup', () => {
  it('renders the signup form', async () => {
    let { router } = await createTestRouter()
    let response = await router.fetch(new URL(routes.signup.index.href(), origin))

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /<form[^>]*method="post"/)
    assert.match(html, /name="password"/)
  })

  it('creates a user, signs them in, and redirects to the dashboard', async () => {
    let { db, router } = await createTestRouter()
    let response = await router.fetch(signupRequest(validFields))

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.dashboard.index.href())

    let user = await db.findOne(users, { where: { email: 'ada@example.com' } })
    assert.ok(user)
    assert.equal(user.name, 'Ada Lovelace')
    assert.notEqual(user.password_hash, validFields.password)
    assert.ok(await verifyPassword(validFields.password, user.password_hash))

    let cookie = getResponseCookie(response, 'session')
    let dashboard = await router.fetch(
      new Request(new URL(routes.dashboard.index.href(), origin), { headers: { Cookie: cookie } }),
    )
    assert.equal(dashboard.status, 200)
    let html = await dashboard.text()
    assert.match(html, /Welcome back, Ada/)
    assert.doesNotMatch(html, /scrypt\$/)
  })

  it('re-renders with field errors and keeps entered values on invalid input', async () => {
    let { db, router } = await createTestRouter()
    let response = await router.fetch(
      signupRequest({ name: '   ', email: 'not-an-email', password: 'short' }),
    )

    assert.equal(response.status, 400)
    let html = await response.text()
    assert.match(html, /id="signup-name-error"/)
    assert.match(html, /id="signup-email-error"/)
    assert.match(html, /id="signup-password-error"/)
    assert.match(html, /value="not-an-email"/)
    assert.doesNotMatch(html, /value="short"/)
    assert.equal((await db.findMany(users)).length, 0)
  })

  it('rejects a duplicate email', async () => {
    let { db, router } = await createTestRouter()
    await router.fetch(signupRequest(validFields))
    let response = await router.fetch(
      signupRequest({ ...validFields, email: 'ADA@example.com', name: 'Someone Else' }),
    )

    assert.equal(response.status, 409)
    assert.match(await response.text(), /already exists/)
    assert.equal((await db.findMany(users)).length, 1)
  })
})
