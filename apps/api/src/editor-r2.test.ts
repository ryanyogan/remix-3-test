import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { createR2FileStorage, type R2Like } from '@trellix/data/r2-file-storage'
import { createTestRouter, origin, signUp } from '../test/router.ts'

describe('editor uploads through the production R2 adapter', () => {
  it('writes R2 metadata, claims the object, downloads it privately, and deletes its bytes', async () => {
    let objects = new Map<string, { key: string; bytes: ArrayBuffer; size: number; uploaded: Date; httpMetadata: { contentType: string }; customMetadata: Record<string, string> }>()
    let bucket: R2Like = {
      async put(key, bytes, options) { objects.set(key, { key, bytes, size: bytes.byteLength, uploaded: new Date(), ...options }) },
      async get(key) { let object = objects.get(key); return object ? { ...object, arrayBuffer: async () => object.bytes } : null },
      async head(key) { return objects.get(key) ?? null },
      async delete(key) { objects.delete(key) },
      async list() { return { objects: [...objects.values()], truncated: false } },
    }
    let { router } = await createTestRouter(createR2FileStorage(bucket))
    let cookie = await signUp(router)
    async function request(path: string, method = 'GET', body?: unknown) {
      return router.fetch(new Request(origin + '/api/v1' + path, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }))
    }
    let form = new FormData(); form.set('file', new File(['R2-backed attachment'], 'plan.txt', { type: 'text/plain' }))
    let response = await router.fetch(new Request(origin + '/api/v1/uploads', { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: form }))
    assert.equal(response.status, 201)
    let file = (await response.json()).data
    assert.equal(objects.get(file.id)?.customMetadata.name, 'plan.txt')
    assert.equal(objects.get(file.id)?.httpMetadata.contentType, 'application/octet-stream')
    let board = (await (await request('/boards', 'POST', { name: 'R2 check' })).json()).data
    board = (await (await request(`/boards/${board.id}`)).json()).data
    response = await request(`/boards/${board.id}/cards`, 'POST', { title: 'R2 attachment', columnId: board.columns[0].id, descriptionHtml: `<action-text-attachment sgid="${file.id}"></action-text-attachment>` })
    assert.equal(response.status, 201)
    let card = (await response.json()).data
    response = await request('/files/' + file.id)
    assert.equal(await response.text(), 'R2-backed attachment')
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    await request(`/boards/${board.id}/cards/${card.id}`, 'DELETE')
    assert.equal(objects.size, 0)
  })
})
