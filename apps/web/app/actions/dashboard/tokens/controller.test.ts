import * as assert from 'remix/assert'
import { sql } from 'remix/data-table'
import { describe, it } from 'remix/test'

import { routes } from '../../../routes.ts'
import { createTestRouter, origin, signUp } from '../../../../test/router.ts'

const t = routes.dashboard.tokens

// What the browser sends for the token forms without JavaScript: fields, no Accept: JSON.
function post(href: string, cookie: string, fields: [string, string][] = []) {
  return new Request(new URL(href, origin), {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { Origin: origin, Cookie: cookie },
  })
}

describe('access tokens without JavaScript', () => {
  it('shows a new secret once, revokes, and explains a rejected name', async () => {
    let { db, router } = await createTestRouter()
    let cookie = await signUp(router)

    let created = await router.fetch(post(t.create.href(), cookie, [['name', 'Script']]))
    assert.equal(created.status, 200)
    let html = await created.text()
    let secret = /trx_[a-f0-9]{64}/.exec(html)?.[0]
    assert.ok(secret)
    assert.ok(html.includes(`action="${t.create.href()}"`))

    let tokens = async () => (await db.exec(sql`select id from api_tokens`)).rows ?? []
    let [token] = await tokens()
    let page = await (await router.fetch(new Request(new URL(routes.dashboard.account.href(), origin), { headers: { Cookie: cookie } }))).text()
    assert.ok(page.includes('Script'))
    assert.equal(page.includes(secret), false)

    let revoked = await router.fetch(post(t.revoke.href({ tokenId: String(token.id) }), cookie))
    assert.equal(revoked.status, 303)
    assert.equal(revoked.headers.get('Location'), routes.dashboard.account.href())
    assert.equal((await tokens()).length, 0)

    let rejected = await router.fetch(post(t.create.href(), cookie, [['name', ' ']]))
    assert.equal(rejected.status, 422)
    assert.match(await rejected.text(), /role="alert"[^>]*>Token name must be/)
  })
})
