import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { createTestRouter, origin, signUp } from '../../test/router.ts'
import { routes } from '../routes.ts'

describe('root controller', () => {
  it('GET / sends anonymous visitors to login', async () => {
    let { router } = await createTestRouter()
    let response = await router.fetch(new URL(routes.home.href(), origin))

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.login.index.href())
  })

  it('GET / sends signed-in users to the dashboard', async () => {
    let { router } = await createTestRouter()
    let cookie = await signUp(router)
    let response = await router.fetch(
      new Request(new URL(routes.home.href(), origin), { headers: { Cookie: cookie } }),
    )

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.dashboard.index.href())
  })
})
