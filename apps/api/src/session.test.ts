import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { sessionCookie } from '@trellix/session'
import { revokeSessions } from '@trellix/data/sessions'
import { users } from '@trellix/data/tables'
import { createTestRouter, origin, signUp } from '../test/router.ts'

describe('independent API session boundary', () => {
  it('accepts a web-format signed session and rejects forged identity headers and signatures', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let request = (headers: Record<string, string>) => router.fetch(new Request(origin + '/api/v1/me', { headers }))
    assert.equal((await request({ Cookie: cookie })).status, 200)
    assert.equal((await request({ Cookie: cookie + 'forged' })).status, 401)
    assert.equal((await request({ 'X-User-Id': 'admin', 'X-Session-User-Id': 'admin' })).status, 401)
  })
  it('rejects a session issued before its user signed out', async () => {
    let { router, db } = await createTestRouter()
    let cookie = await signUp(router)
    let me = () => router.fetch(new Request(origin + '/api/v1/me', { headers: { Cookie: cookie } }))
    assert.equal((await me()).status, 200)
    let user = await db.findOne(users, { where: { email: 'ada@example.com' } })
    await revokeSessions(db, user!.id)
    assert.equal((await me()).status, 401)
  })
  it('rejects expired and malformed signed sessions', async () => {
    let { router } = await createTestRouter()
    for (let envelope of [{ value: '{"auth":{"userId":"admin"}}', expires: Date.now() - 1 }, { value: '{}', expires: 'tomorrow' }, {}]) {
      let cookie = (await sessionCookie('test-secret').serialize(JSON.stringify(envelope))).split(';')[0]
      assert.equal((await router.fetch(new Request(origin + '/api/v1/me', { headers: { Cookie: cookie } }))).status, 401)
    }
  })
  it('identifies the API service and serves health without authentication or database access', async () => {
    let { router } = await createTestRouter()
    let response = await router.fetch(new Request(origin + '/api/v1/health'))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('X-Trellix-Service'), 'api')
  })
})
