import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { loadActivity } from '@trellix/data/activity'
import { sql, rawSql } from 'remix/data-table'
import { createTestRouter, origin, signUp } from '../test/router.ts'

async function setup() {
  let { router, db, uploads } = await createTestRouter()
  let cookie = await signUp(router)
  async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    return router.fetch(new Request(`${origin}/api/v1${path}`, {
      method, headers: { Cookie: cookie, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  }
  let response = await request('/boards', 'POST', { name: 'Launch', color: '#aabbcc' })
  assert.equal(response.status, 201)
  let { data: created } = await response.json()
  response = await request(`/boards/${created.id}`)
  assert.equal(response.status, 200)
  let { data: board } = await response.json()
  response = await request(`/boards/${board.id}/cards`, 'POST', { title: 'Ship something lovely', columnId: board.columns[0].id })
  assert.equal(response.status, 201)
  let { data: card } = await response.json()
  let path = `/boards/${board.id}/cards/${card.id}`
  return { request, router, db, uploads, cookie, board, card, path }
}

describe('Hono API', () => {
  it('persists board watching, filters new-card notifications, and protects ownership', async () => {
    let { request, board, router, cookie, db } = await setup()
    let me = (await (await request('/me')).json()).data
    let base = `/boards/${board.id}`
    let loaded = (await (await request(base)).json()).data
    assert.equal(loaded.watching, true)
    assert.equal(loaded.items[0].author, 'Ada Lovelace')
    assert.ok(loaded.items[0].createdAt > 0)
    assert.ok(loaded.items[0].updatedAt >= loaded.items[0].createdAt)
    assert.equal((await loadActivity(db, me.id, { view: 'notifications' })).events.length, 1)
    assert.equal((await request(base + '/watch', 'PUT', { watching: false })).status, 204)
    assert.equal((await (await request(base)).json()).data.watching, false)
    assert.equal((await loadActivity(db, me.id, { view: 'notifications' })).events.length, 0)
    assert.equal((await request(base + '/watch', 'PUT', { watching: true })).status, 204)
    assert.equal((await request(base + '/cards', 'POST', { title: 'A watched card', columnId: board.columns[0].id })).status, 201)
    assert.ok((await loadActivity(db, me.id, { view: 'notifications' })).events.some(event => event.title === 'A watched card'))
    assert.equal((await request(base + '/watch', 'PUT', { watching: 'maybe' })).status, 422)
    let other = await signUp(router, 'other-watcher@example.com')
    assert.equal((await request(base + '/watch', 'PUT', { watching: false }, { Cookie: other })).status, 404)
    assert.equal((await (await request(base, 'GET', undefined, { Cookie: cookie })).json()).data.watching, true)
  })

  it('persists column colors, preserves them on rename, and rejects invalid colors', async () => {
    let { request, board } = await setup()
    let base = `/boards/${board.id}`
    let column = board.columns[1].id
    assert.equal((await request(`${base}/columns/${column}`, 'PATCH', { name: 'Yes', color: 'tan' })).status, 204)
    let loaded = (await (await request(base)).json()).data
    assert.equal(loaded.columns[1].color, 'tan')
    assert.equal((await request(`${base}/columns/${column}`, 'PATCH', { name: 'Review' })).status, 204)
    assert.equal((await (await request(base)).json()).data.columns[1].color, 'tan')
    assert.equal((await request(`${base}/columns/${column}`, 'PATCH', { name: 'Invalid', color: 'red' })).status, 422)
    assert.equal((await (await request(base)).json()).data.columns[1].name, 'Review')
    let created = (await (await request(`${base}/columns`, 'POST', { name: 'New color', color: 'pink' })).json()).data.id
    assert.equal((await (await request(base)).json()).data.columns.find((value: { id: string }) => value.id === created).color, 'pink')
  })

  it('reorders only work columns and returns deleted-column cards to intake', async () => {
    let { request, router, board, path, card } = await setup()
    let base = `/boards/${board.id}`
    let review = (await (await request(base + '/columns', 'POST', { name: 'Review' })).json()).data.id
    let move = (id: string, direction: string) => request(`${base}/columns/${id}/position`, 'POST', { direction })
    assert.equal((await move(board.columns[1].id, 'left')).status, 422)
    assert.equal((await move(review, 'right')).status, 422)
    assert.equal((await move(board.columns[0].id, 'right')).status, 422)
    assert.equal((await move(board.columns[2].id, 'left')).status, 422)
    assert.equal((await move(review, 'up')).status, 422)
    assert.equal((await move(review, 'left')).status, 204)
    let loaded = (await (await request(base)).json()).data
    assert.deepEqual(loaded.columns.map((column: { name: string }) => column.name), ['To do', 'Review', 'In progress', 'Done'])
    let other = await signUp(router, 'column-outsider@example.com')
    assert.equal((await request(`${base}/columns/${review}/position`, 'POST', { direction: 'right' }, { Cookie: other })).status, 404)
    assert.equal((await move(review, 'right')).status, 204)
    assert.equal((await request(path, 'PATCH', { columnId: review })).status, 204)
    let me = (await (await request('/me')).json()).data
    assert.equal((await request(path, 'PATCH', { assigneeId: me.id })).status, 204)
    assert.equal((await request(`${base}/columns/${review}`, 'DELETE')).status, 204)
    loaded = (await (await request(base)).json()).data
    assert.equal(loaded.items.find((item: { id: string }) => item.id === card.id).columnId, board.columns[0].id)
    assert.equal(loaded.items.find((item: { id: string }) => item.id === card.id).assigneeId, me.id)
  })

  it('inserts new work columns before Done and Not Now before the intake column', async () => {
    let { request, board, path } = await setup()
    let base = `/boards/${board.id}`
    assert.equal((await request(base + '/columns', 'POST', { name: 'Review' })).status, 201)
    assert.equal((await request(base + '/columns', 'POST', { name: 'Not Now' })).status, 201)
    let columns = (await (await request(base)).json()).data.columns
    assert.deepEqual(columns.map((column: { name: string }) => column.name), ['Not Now', 'To do', 'In progress', 'Review', 'Done'])
    assert.equal((await request(path, 'PATCH', { columnId: columns.at(-1).id })).status, 204)
  })

  it('round-trips safe rich text and preserves plain-text clients and search', async () => {
    let { request, path, board } = await setup()
    let html = '<p>Hello <strong>world</strong> &amp; friends</p><ul><li>First step</li></ul><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)" onclick="alert(1)">unsafe</a>'
    assert.equal((await request(path, 'PATCH', { descriptionHtml: html })).status, 204)
    let detail = (await (await request(path)).json()).data
    assert.match(detail.description_html, /<strong>world<\/strong>/)
    assert.match(detail.description_html, /<li>First step<\/li>/)
    assert.equal(/script|onerror|onclick|javascript:/i.test(detail.description_html), false)
    assert.match(detail.description, /Hello world & friends/)
    assert.equal((await (await request('/cards?q=First%20step')).json()).data.length, 1)
    assert.equal((await request(path + '/comments', 'POST', { bodyHtml: '<p><em>Looks good</em></p>' })).status, 201)
    detail = (await (await request(path)).json()).data
    assert.equal(detail.comments[0].body, 'Looks good')
    assert.match(detail.comments[0].body_html, /<em>Looks good<\/em>/)
    assert.equal((await request(path + '/comments', 'POST', { bodyHtml: '<p><br></p>' })).status, 422)
    assert.equal((await request(path, 'PATCH', { description: '<b>Literal text</b>' })).status, 204)
    detail = (await (await request(path)).json()).data
    assert.equal(detail.description, '<b>Literal text</b>')
    assert.equal(detail.description_html, '')
    let response = await request(`/boards/${board.id}/cards`, 'POST', { title: 'Rich creation', columnId: board.columns[0].id, descriptionHtml: '<h2>Context</h2><p>Saved together</p>' })
    assert.equal(response.status, 201)
    let created = (await response.json()).data
    detail = (await (await request(`/boards/${board.id}/cards/${created.id}`)).json()).data
    assert.match(detail.description_html, /<h2>Context<\/h2>/)
    assert.equal((await request(path, 'PATCH', { descriptionHtml: 'x'.repeat(60001) })).status, 422)
  })

  it('creates tags, assignment, and steps atomically and rejects unrelated assignees', async () => {
    let { request, board, path, router } = await setup()
    let me = (await (await request('/me')).json()).data
    let payload = { title: 'Ready to create', columnId: board.columns[0].id, descriptionHtml: '<p>Context</p>', tags: ['Design', 'design'], assigneeId: me.id, steps: [{ title: 'First', completed: true }, { title: 'Second' }] }
    let response = await request(`/boards/${board.id}/cards`, 'POST', payload)
    assert.equal(response.status, 201)
    let id = (await response.json()).data.id
    let cardPath = `/boards/${board.id}/cards/${id}`
    let card = (await (await request(cardPath)).json()).data
    assert.deepEqual(card.tags, ['design'])
    assert.equal(card.assignee_id, me.id)
    assert.equal(card.steps.length, 2)
    assert.equal(card.steps.find((step: { title: string }) => step.title === 'First').completed, 1)
    assert.deepEqual(card.steps.map((step: { title: string }) => step.title), ['First', 'Second'])
    let countBeforeRetry = (await (await request(`/boards/${board.id}`)).json()).data.items.length
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { ...payload, id, tags: ['retry'], steps: [{ title: 'Revised step' }] })).status, 201)
    card = (await (await request(cardPath)).json()).data
    assert.deepEqual(card.tags, ['retry'])
    assert.equal(card.steps.length, 1)
    assert.equal(card.steps[0].title, 'Revised step')
    assert.equal((await (await request(`/boards/${board.id}`)).json()).data.items.length, countBeforeRetry)
    assert.equal((await request(cardPath, 'PATCH', { assigneeId: null })).status, 204)
    assert.equal((await (await request(cardPath)).json()).data.assignee_id, null)
    let other = await signUp(router, 'assignee-other@example.test')
    let foreign = (await (await request('/me', 'GET', undefined, { Cookie: other })).json()).data
    assert.equal((await request(path, 'PATCH', { assigneeId: foreign.id })).status, 422)
    let count = (await (await request(`/boards/${board.id}`)).json()).data.items.length
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { ...payload, assigneeId: foreign.id })).status, 422)
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { ...payload, steps: [{ title: '' }] })).status, 422)
    assert.equal((await (await request(`/boards/${board.id}`)).json()).data.items.length, count)
  })

  it('persists private cover images, moves them with a card, and removes them', async () => {
    let { request, router, cookie, board, card, path } = await setup()
    // Real one-pixel PNG, including a valid image signature.
    let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFe8AAAAASUVORK5CYII=', 'base64')
    async function cover(file: File, auth = cookie) {
      let body = new FormData(); body.set('file', file)
      return router.fetch(new Request(`${origin}/api/v1${path}/cover`, { method: 'POST', headers: { Cookie: auth, Origin: origin }, body }))
    }
    assert.equal((await cover(new File(['<svg/>'], 'fake.png', { type: 'image/png' }))).status, 422)
    assert.equal((await cover(new File(['x'], 'test.svg', { type: 'image/svg+xml' }))).status, 422)
    assert.equal((await cover(new File([png], 'cover.png', { type: 'image/png' }))).status, 201)
    let detail = (await (await request(path)).json()).data
    let oldId = detail.cover_file_id
    let response = await request(path + '/cover')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Disposition'), 'inline')
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal((await response.arrayBuffer()).byteLength, png.length)
    let other = await signUp(router, 'cover-other@example.test')
    assert.equal((await request(path + '/cover', 'GET', undefined, { Cookie: other })).status, 404)
    assert.equal((await cover(new File([png], 'cover.png', { type: 'image/png' }), other)).status, 404)
    assert.equal((await cover(new File([png], 'replacement.png', { type: 'image/png' }))).status, 201)
    assert.equal((await request(`/boards/${board.id}/files/${oldId}`)).status, 404)
    let target = (await (await request('/boards', 'POST', { name: 'Move target' })).json()).data
    let foreign = (await (await request('/boards', 'POST', { name: 'Private target' }, { Cookie: other })).json()).data
    assert.equal((await request(path, 'PATCH', { boardId: foreign.id })).status, 404)
    assert.equal((await request(path, 'PATCH', { boardId: target.id })).status, 204)
    let movedPath = `/boards/${target.id}/cards/${card.id}`
    assert.equal((await request(path)).status, 404)
    detail = (await (await request(movedPath)).json()).data
    assert.equal(detail.files.length, 1)
    assert.equal((await request(movedPath + '/cover')).status, 200)
    assert.equal((await request(`/boards/${target.id}/files/${detail.cover_file_id}`)).status, 200)
    assert.equal((await request(movedPath + '/cover', 'DELETE')).status, 204)
    assert.equal((await request(movedPath + '/cover')).status, 404)
    assert.equal((await (await request(movedPath)).json()).data.cover_file_id, null)
    assert.equal((await (await request(movedPath)).json()).data.files.length, 0)
  })

  it('stages private editor files, claims them with rich content, and cleans up card storage', async () => {
    let { request, router, db, uploads, cookie, board } = await setup()
    let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFe8AAAAASUVORK5CYII=', 'base64')
    async function upload(file: File) {
      let body = new FormData(); body.set('file', file)
      let response = await router.fetch(new Request(origin + '/api/v1/uploads', { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body }))
      assert.equal(response.status, 201)
      return (await response.json()).data
    }
    let image = await upload(new File([png], 'example.png', { type: 'image/png' }))
    let file = await upload(new File(['Attachment bytes'], 'notes.txt', { type: 'text/plain' }))
    assert.equal(image.previewable, true)
    assert.equal(file.previewable, false)
    assert.equal((await request('/files/' + image.id)).headers.get('Content-Disposition')?.startsWith('inline;'), true)
    assert.equal((await request('/files/' + file.id)).headers.get('Content-Disposition')?.startsWith('attachment;'), true)
    let html = `<p>Context</p><action-text-attachment sgid="${image.id}" url="javascript:alert(1)" filename="fake" content-type="text/html" caption="Screenshot"><script>alert(1)</script><img src=x onerror=alert(1)></action-text-attachment><action-text-attachment sgid="${file.id}"></action-text-attachment>`
    let result = await request(`/boards/${board.id}/cards`, 'POST', { title: 'With inline files', columnId: board.columns[0].id, descriptionHtml: html })
    assert.equal(result.status, 201)
    let id = (await result.json()).data.id, path = `/boards/${board.id}/cards/${id}`
    let detail = (await (await request(path)).json()).data
    assert.equal(detail.files.length, 2)
    assert.match(detail.description_html, new RegExp(`<img src="/api/v1/files/${image.id}"`))
    assert.match(detail.description_html, /filename="example.png"/)
    assert.match(detail.description_html, /notes.txt/)
    assert.equal(/javascript:|onerror|<script|filename="fake"/.test(detail.description_html), false)
    assert.equal((await db.exec(sql`select count(*) as count from editor_uploads`)).rows?.[0].count, 0)
    assert.equal((await request(path, 'PATCH', { descriptionHtml: detail.description_html })).status, 204)
    assert.equal((await (await request(path)).json()).data.files.length, 2)
    assert.equal((await request('/uploads/' + image.id, 'DELETE')).status, 204)
    assert.equal(await uploads.has(image.id), true)
    let comment = await upload(new File(['Comments support files too'], 'comment.txt'))
    assert.equal((await request(path + '/comments', 'POST', { bodyHtml: `<action-text-attachment sgid="${comment.id}"></action-text-attachment>` })).status, 201)
    detail = (await (await request(path)).json()).data
    assert.match(detail.comments[0].body, /comment.txt/)
    assert.equal(detail.files.length, 3)
    assert.equal((await request(path, 'DELETE')).status, 204)
    for (let id of [image.id, file.id, comment.id]) { assert.equal(await uploads.has(id), false); assert.equal((await request('/files/' + id)).status, 404) }
  })

  it('rejects foreign, expired, and over-limit editor attachments without partial card writes', async () => {
    let { request, router, cookie, board, path, db, uploads } = await setup()
    async function upload(file: File, auth = cookie) {
      let body = new FormData(); body.set('file', file)
      return router.fetch(new Request(origin + '/api/v1/uploads', { method: 'POST', headers: { Cookie: auth, Origin: origin }, body }))
    }
    assert.equal((await upload(new File([], 'empty'))).status, 422)
    assert.equal((await upload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large'))).status, 422)
    let other = await signUp(router, 'editor-other@example.test')
    let foreign = (await (await upload(new File(['secret'], 'secret.txt'), other)).json()).data
    assert.equal((await request('/files/' + foreign.id)).status, 404)
    assert.equal((await request(path, 'PATCH', { descriptionHtml: `<action-text-attachment sgid="${foreign.id}"></action-text-attachment>` })).status, 422)
    assert.equal((await (await request(path)).json()).data.description, '')
    assert.equal((await request('/uploads/' + foreign.id, 'DELETE')).status, 204)
    assert.equal(await uploads.has(foreign.id), true)
    let mine = (await (await upload(new File(['<svg onload="alert(1)"></svg>'], 'image.svg', { type: 'image/svg+xml' }))).json()).data
    assert.equal(mine.previewable, false)
    assert.equal((await request('/files/' + mine.id)).headers.get('Content-Type'), 'application/octet-stream')
    let before = (await (await request(`/boards/${board.id}`)).json()).data.items.length
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { title: 'No partial creation', columnId: 'missing', descriptionHtml: `<action-text-attachment sgid="${mine.id}"></action-text-attachment>` })).status, 404)
    assert.equal((await (await request(`/boards/${board.id}`)).json()).data.items.length, before)
    assert.equal((await db.exec(sql`select count(*) as count from editor_uploads where id = ${mine.id}`)).rows?.[0].count, 1)
    await db.exec(sql`update editor_uploads set created_at = 1 where id = ${mine.id}`)
    assert.equal((await request('/files/' + mine.id)).status, 404)
    assert.equal((await request(path, 'PATCH', { descriptionHtml: `<action-text-attachment sgid="${mine.id}"></action-text-attachment>` })).status, 422)
    let fresh = (await (await upload(new File(['new'], 'new.txt'))).json()).data
    assert.equal(await uploads.has(mine.id), false)
    await request('/uploads/' + fresh.id, 'DELETE')
    assert.equal(await uploads.has(fresh.id), false)
    let ids: string[] = []
    for (let i = 0; i < 11; i++) ids.push((await (await upload(new File(['x'], `file${i}.txt`))).json()).data.id)
    assert.equal((await request(path, 'PATCH', { descriptionHtml: ids.map(id => `<action-text-attachment sgid="${id}"></action-text-attachment>`).join('') })).status, 422)
    assert.equal((await (await request(path)).json()).data.files.length, 0)
  })

  it('creates boards from names and ignores legacy color input', async () => {
    let { request, board } = await setup()
    assert.equal(board.color, '#cbd5e1')
    let response = await request('/boards', 'POST', { name: ' Name only ' })
    assert.equal(response.status, 201)
    let { data } = await response.json()
    assert.equal(data.name, 'Name only')
    assert.equal(Object.hasOwn(data, 'color'), false)
    assert.equal((await (await request(`/boards/${data.id}`)).json()).data.color, '#cbd5e1')
  })

  it('returns a bounded, private workspace with independent pins and current card previews', async () => {
    let { request, router, db, board, card, path } = await setup()
    // Keep an old pin outside the recent page; it must still be reachable from home.
    await db.exec(sql`update board_items set created_at = 1 where id = ${card.id}`)
    await db.exec(sql`insert into card_details(item_id, pinned, updated_at) values (${card.id}, 1, 1)`)
    for (let index = 0; index < 30; index++) {
      await db.exec(sql`insert into board_items(id, board_id, column_id, title, position, created_at)
        values (${crypto.randomUUID()}, ${board.id}, ${board.columns[0].id}, ${`Card ${index}`}, ${index + 2}, ${1000 + index})`)
    }
    let response = await request('/workspace')
    assert.equal(response.status, 200)
    let { data } = await response.json()
    assert.equal(data.recent.length, 24)
    assert.equal(data.recent[0].title, 'Card 29')
    assert.equal(data.pinned.length, 1)
    assert.equal(data.pinned[0].id, card.id)
    assert.equal(data.boards[0].previews.length, 3)
    assert.equal(data.boards[0].total, 31)
    assert.equal(data.boards[0].done, 0)
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { id: card.id, title: 'Moved to done', columnId: board.columns[2].id })).status, 201)
    data = (await (await request('/workspace')).json()).data
    assert.equal(data.recent[0].id, card.id)
    assert.equal(data.recent[0].done, true)
    assert.equal(data.boards[0].done, 1)
    assert.equal((await request(path, 'PATCH', { pinned: false })).status, 204)
    assert.equal((await (await request('/workspace')).json()).data.pinned.length, 0)
    let other = await signUp(router, 'workspace-other@example.test')
    assert.deepEqual((await (await request('/workspace', 'GET', undefined, { Cookie: other })).json()).data, { boards: [], recent: [], pinned: [] })
  })

  it('records completion and reopening without relabeling history, and keeps activity private', async () => {
    let { request, router, db, board, card, path } = await setup()
    let user = (await (await request('/me')).json()).data
    assert.equal((await request(path, 'PATCH', { columnId: board.columns[2].id })).status, 204)
    assert.equal((await request(path, 'PATCH', { columnId: board.columns[0].id })).status, 204)
    assert.equal((await request(path + '/comments', 'POST', { body: 'A real comment' })).status, 201)
    assert.equal((await request(path, 'PATCH', { tags: ['design'], pinned: true })).status, 204)
    let page = await loadActivity(db, user.id)
    assert.equal(page.events.filter(e => e.kind === 'done').length, 1)
    assert.equal(page.events.filter(e => e.kind === 'moved').length, 1)
    assert.equal(page.events.find(e => e.kind === 'commented')?.detail, 'A real comment')
    assert.equal((await loadActivity(db, user.id, { view: 'added' })).events.length, 1)
    assert.equal((await loadActivity(db, user.id, { tag: 'missing' })).events.length, 0)
    assert.equal((await loadActivity(db, user.id, { board: 'other' })).events.length, 0)
    assert.equal((await loadActivity(db, user.id, { person: 'other' })).events.length, 0)
    assert.equal((await loadActivity(db, user.id, { view: 'pinned' })).events.length, page.events.length)
    let navigation = (await (await request('/navigation')).json()).data
    assert.deepEqual(navigation.tags, ['design'])
    let otherCookie = await signUp(router, 'activity-other@example.test')
    let other = (await (await request('/me', 'GET', undefined, { Cookie: otherCookie })).json()).data
    assert.equal((await loadActivity(db, other.id, { board: board.id })).events.length, 0)
    assert.deepEqual((await (await request('/navigation', 'GET', undefined, { Cookie: otherCookie })).json()).data, { boards: [], tags: [] })
    assert.equal((await request(path, 'DELETE')).status, 204)
    assert.equal((await loadActivity(db, user.id)).events.length, 0)
    assert.equal((await db.exec(sql`select * from card_activity where item_id = ${card.id}`)).rows?.length, 0)
  })

  it('pages activity without losing events that share a timestamp', async () => {
    let { request, db, card } = await setup()
    let user = (await (await request('/me')).json()).data
    for (let i = 0; i < 105; i++) await db.exec(sql`insert into card_activity(id, item_id, kind, detail, created_at) values (${String(i).padStart(3, '0')}, ${card.id}, 'updated', '', ${1000})`)
    let first = await loadActivity(db, user.id)
    assert.equal(first.events.length, 100)
    assert.ok(first.next)
    let second = await loadActivity(db, user.id, first.next!)
    assert.equal(second.events.length, 6)
    assert.equal(second.next, null)
    assert.equal(new Set([...first.events, ...second.events].map(e => e.id)).size, 106)
  })

  it('requires authentication, JSON, and same-origin browser writes', async () => {
    let { router, request, cookie } = await setup()
    let response = await router.fetch(new Request(`${origin}/api/v1/boards`))
    assert.equal(response.status, 401)
    response = await request('/boards', 'POST', { name: 'Unsafe' }, { Origin: 'https://evil.example' })
    assert.equal(response.status, 403)
    response = await router.fetch(new Request(`${origin}/api/v1/tokens`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"name":"Bad"}' }))
    assert.equal(response.status, 403)
    response = await request('/boards', 'POST', { name: 'Unsafe' }, { 'Content-Type': 'text/plain' })
    assert.equal(response.status, 415)
    response = await request('/boards', 'POST', { name: 'A'.repeat(70000) })
    assert.equal(response.status, 413)
  })

  it('preserves optimistic client IDs and prevents cross-board upserts', async () => {
    let { request, board, router } = await setup()
    let id = crypto.randomUUID()
    let body = { id, title: 'Created optimistically', columnId: board.columns[0].id, position: 5 }
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', body)).status, 201)
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { ...body, columnId: board.columns[1].id })).status, 201)
    let card = (await (await request(`/boards/${board.id}/cards/${id}`)).json()).data
    assert.equal(card.column_id, board.columns[1].id)
    assert.equal(card.position, 5)
    let cookie = await signUp(router, 'other@example.test')
    let other = (await (await request('/boards', 'POST', { name: 'Other' }, { Cookie: cookie })).json()).data
    let otherBoard = (await (await request(`/boards/${other.id}`, 'GET', undefined, { Cookie: cookie })).json()).data
    assert.equal((await request(`/boards/${other.id}/cards`, 'POST', { ...body, columnId: otherBoard.columns[0].id }, { Cookie: cookie })).status, 404)
    assert.equal((await request(`/boards/${board.id}/cards`, 'POST', { ...body, id: 'invalid' })).status, 422)
  })

  it('persists card details, steps, comments and compact board summaries', async () => {
    let { request, path, board, card } = await setup()
    assert.equal((await request(path, 'PATCH', { description: 'Ready for a small launch', tags: ['Design', 'design', 'release'], pinned: true, priority: 'urgent' })).status, 204)
    let step = await (await request(path + '/steps', 'POST', { title: 'Check keyboard navigation' })).json()
    assert.equal((await request(path + '/steps/' + step.data.id, 'PATCH', { completed: true })).status, 204)
    assert.equal((await request(path + '/comments', 'POST', { body: 'It feels good!' })).status, 201)
    let { data } = await (await request(path)).json()
    assert.equal(data.description, 'Ready for a small launch')
    assert.deepEqual(data.tags, ['design', 'release'])
    assert.equal(data.steps[0].completed, 1)
    assert.equal(data.comments[0].author, 'Ada Lovelace')
    let snapshot = await (await request('/boards/' + board.id)).json()
    let summary = snapshot.data.items.find((item: { id: string }) => item.id === card.id).detail
    assert.equal(summary.completedSteps, 1)
    assert.equal(summary.comments, 1)
    assert.equal(summary.hasDescription, true)
    assert.equal('description' in summary, false)
  })

  it('hides all resources from another user, including nested mutations', async () => {
    let { request, router, path, board } = await setup()
    let other = await signUp(router, 'grace@example.com')
    for (let [endpoint, method, body] of [
      ['/boards/' + board.id, 'GET', undefined], [path, 'GET', undefined],
      [path, 'PATCH', { title: 'Stolen' }], [path + '/steps', 'POST', { title: 'Stolen' }],
      [path + '/comments', 'POST', { body: 'Stolen' }], [path, 'DELETE', undefined],
    ] as const) assert.equal((await request(endpoint, method, body, { Cookie: other })).status, 404)
    let response = await request('/cards?q=lovely', 'GET', undefined, { Cookie: other })
    assert.deepEqual((await response.json()).data, [])
  })

  it('validates every update before writing and rejects foreign column moves', async () => {
    let { request, path, router } = await setup()
    for (let body of [{ title: '' }, { priority: 'bad' }, { pinned: 'true' }, { tags: ['x'.repeat(31)] }, { snoozedUntil: -1 }, { position: '0' }]) {
      assert.equal((await request(path, 'PATCH', { title: 'Should not persist', ...body })).status, 422)
    }
    let otherCookie = await signUp(router, 'grace@example.com')
    let otherBoard = await (await request('/boards', 'POST', { name: 'Private' }, { Cookie: otherCookie })).json()
    let other = await (await request('/boards/' + otherBoard.data.id, 'GET', undefined, { Cookie: otherCookie })).json()
    assert.equal((await request(path, 'PATCH', { columnId: other.data.columns[0].id })).status, 404)
    assert.equal((await (await request(path)).json()).data.title, 'Ship something lovely')
  })

  it('issues hashed tokens, authenticates bearer calls, and revokes immediately', async () => {
    let { request, db } = await setup()
    let response = await request('/tokens', 'POST', { name: 'Integration' })
    assert.equal(response.status, 201)
    let { data } = await response.json()
    let rows = await db.exec(sql`select token_hash from api_tokens where id = ${data.id}`)
    assert.notEqual(rows.rows![0].token_hash, data.token)
    let headers = { Cookie: '', Authorization: `Bearer ${data.token}`, Origin: '' }
    assert.equal((await request('/boards', 'GET', undefined, headers)).status, 200)
    assert.equal((await request('/boards', 'POST', { name: 'From API' }, headers)).status, 201)
    assert.equal((await request('/tokens', 'POST', { name: 'Escalation' }, headers)).status, 403)
    assert.equal((await request('/tokens', 'GET', undefined, headers)).status, 403)
    assert.equal((await request(`/tokens/${data.id}`, 'DELETE')).status, 204)
    assert.equal((await request('/boards', 'GET', undefined, headers)).status, 401)
    assert.equal((await request('/boards', 'GET', undefined, { Authorization: 'Bearer bad' })).status, 401)
  })

  it('searches descriptions and tags with bounded, stable pagination', async () => {
    let { request, path, board } = await setup()
    await request(path, 'PATCH', { description: '100% complete', tags: ['design'], pinned: true })
    for (let query of ['q=100%25', 'q=design', 'pinned=true']) assert.equal((await (await request('/cards?' + query)).json()).data.length, 1)
    assert.equal((await (await request('/cards?q=%25')).json()).data.length, 1)
    await request(`/boards/${board.id}/cards`, 'POST', { title: 'Another', columnId: board.columns[0].id })
    let first = await (await request('/cards?limit=1')).json()
    assert.equal(first.data.length, 1)
    assert.ok(first.next)
    let second = await (await request('/cards?limit=1&after=' + first.next)).json()
    assert.equal(second.data.length, 1)
    assert.notEqual(first.data[0].id, second.data[0].id)
    assert.equal(second.next, null)
  })

  it('cascades card metadata and never returns password hashes or token hashes', async () => {
    let { request, path, db } = await setup()
    await request(path, 'PATCH', { description: 'Temporary' })
    await request(path + '/steps', 'POST', { title: 'Temporary' })
    await request(path + '/comments', 'POST', { body: 'Temporary' })
    let me = await (await request('/me')).json()
    assert.equal('password_hash' in me.data, false)
    await request('/tokens', 'POST', { name: 'Private' })
    let tokens = await (await request('/tokens')).json()
    assert.equal('token_hash' in tokens.data[0], false)
    assert.equal((await request(path, 'DELETE')).status, 204)
    for (let name of ['card_details', 'card_steps', 'card_comments']) {
      let result = await db.exec(rawSql(`select count(*) as n from ${name}`))
      assert.equal(result.rows?.[0].n, 0)
    }
  })
})

describe('API attachments', () => {
  it('uploads, downloads and deletes files while enforcing board access', async () => {
    let { router, cookie, path, board, request } = await setup()
    let form = new FormData()
    form.set('file', new File(['hello from the API'], 'notes.txt', { type: 'text/plain' }))
    let response = await router.fetch(new Request(`${origin}/api/v1${path}/files`, {
      method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: form,
    }))
    assert.equal(response.status, 201)
    let { data } = await response.json()
    let filePath = `/boards/${board.id}/files/${data.id}`
    response = await request(filePath)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'hello from the API')
    assert.ok(response.headers.get('Content-Disposition')?.startsWith('attachment'))
    let stranger = await signUp(router, 'stranger@example.com')
    assert.equal((await request(filePath, 'GET', undefined, { Cookie: stranger })).status, 404)
    assert.equal((await request(filePath, 'DELETE', undefined, { Cookie: stranger })).status, 404)
    assert.equal((await request(filePath, 'DELETE')).status, 204)
    assert.equal((await request(filePath)).status, 404)
  })
})
