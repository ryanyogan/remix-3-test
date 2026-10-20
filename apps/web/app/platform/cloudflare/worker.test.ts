import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import worker from './worker.ts'

describe('Cloudflare worker', () => {
  it('answers a malformed asset path with 404 and security headers', async () => {
    let assets = { fetch: async () => new Response('should not be reached', { status: 500 }) }
    let response = await worker.fetch(new Request('http://localhost/assets/%E0%A4%A.js'), { ASSETS: assets })
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  })

  it('serves assets with module content types', async () => {
    let assets = { fetch: async () => new Response('export {}') }
    let response = await worker.fetch(new Request('http://localhost/assets/app/entry.ts'), { ASSETS: assets })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/javascript; charset=utf-8')
  })
})
