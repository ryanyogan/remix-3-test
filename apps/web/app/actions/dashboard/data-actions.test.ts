import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { boards, boardColumns } from '@trellix/data/tables'
import { createApi } from '../../../../api/src/app.ts'
import { createTestRouter, origin, signUp } from '../../../test/router.ts'
import { routes } from '../../routes.ts'

async function setup() {
  let fixture = await createTestRouter(),
    cookie = await signUp(fixture.router)
  let call = (
    href: string,
    body?: unknown,
    session = cookie,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    fixture.router.fetch(
      new Request(new URL(href, origin), {
        method,
        headers: {
          Cookie: session,
          Origin: origin,
          Accept: 'application/json',
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        },
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      }),
    )
  let form = new FormData()
  form.set('name', 'Direct database')
  await call(routes.dashboard.boards.create.href(), form)
  let board = (await fixture.db.findMany(boards))[0]
  let columns = await fixture.db.findMany(boardColumns, {
    where: { board_id: board.id },
    orderBy: ['position', 'asc'],
  })
  return { ...fixture, cookie, call, boardId: board.id, userId: board.user_id, columns }
}
const b = routes.dashboard.boards,
  c = routes.dashboard.cards,
  u = routes.dashboard.uploads,
  t = routes.dashboard.tokens
async function data(response: Response) {
  assert.equal(response.status, 200)
  return (await response.json()).data
}

describe('Remix direct database actions', () => {
  it('creates, edits, moves and deletes cards, steps and comments through app routes', async () => {
    let { call, boardId, columns, userId } = await setup()
    let { id: cardId } = await data(
      await call(c.create.href({ boardId }), {
        title: 'Direct card',
        columnId: columns[0].id,
        descriptionHtml: '<p>A <strong>description</strong></p>',
        tags: ['alpha'],
        assigneeId: userId,
      }),
    )
    let params = { boardId, cardId }
    assert.equal(
      (
        await call(c.update.href(params), {
          pinned: true,
          priority: 'high',
          columnId: columns[1].id,
        })
      ).status,
      204,
    )
    let { id: stepId } = await data(await call(c.addStep.href(params), { title: 'A step' }))
    assert.equal(
      (await call(c.updateStep.href({ ...params, stepId }), { completed: true })).status,
      204,
    )
    let { id: commentId } = await data(
      await call(c.addComment.href(params), { bodyHtml: '<p>A <em>comment</em></p>' }),
    )
    let card = await data(await call(c.data.href(params)))
    assert.equal(card.pinned, 1)
    assert.equal(card.steps[0].completed, 1)
    assert.equal(card.column_id, columns[1].id)
    assert.equal(card.assignee_id, userId)
    assert.match(card.comments[0].body_html, /<em>comment<\/em>/)
    let search = await (await call(routes.dashboard.search.href() + '?q=Direct&limit=1')).json()
    assert.equal(search.data[0].id, cardId)
    assert.equal((await call(c.removeStep.href({ ...params, stepId }), {}, undefined)).status, 204)
    assert.equal((await call(c.removeComment.href({ ...params, commentId }), {})).status, 204)
    assert.equal((await call(c.destroy.href(params), {})).status, 204)
    assert.equal((await call(c.data.href(params))).status, 404)
  })

  it('shares validation and ownership checks with consumers and rejects malformed and cross-origin writes', async () => {
    let { call, router, cookie, boardId, columns } = await setup()
    let href = c.create.href({ boardId }),
      valid = { title: 'Owned', columnId: columns[0].id }
    assert.equal((await call(href, valid, '')).status, 401)
    let other = await signUp(router, 'other@example.com')
    assert.equal((await call(href, valid, other)).status, 404)
    assert.equal((await call(href, { ...valid, assigneeId: 'someone-else' })).status, 422)
    assert.equal((await call(href, { ...valid, title: 'x'.repeat(1000) })).status, 422)
    assert.equal((await call(href, { ...valid, descriptionHtml: 'x'.repeat(70000) })).status, 413)
    assert.equal((await call(href, [])).status, 400)
    for (let requestOrigin of ['https://other.example', 'null']) {
      let response = await router.fetch(
        new Request(new URL(href, origin), {
          method: 'POST',
          headers: { Origin: requestOrigin, Cookie: other, 'Content-Type': 'application/json' },
          body: JSON.stringify(valid),
        }),
      )
      assert.equal(response.status, 403)
    }
    assert.equal(
      (
        await router.fetch(
          new Request(new URL(href, origin), {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify(valid),
          }),
        )
      ).status,
      403,
    )
    let response = await router.fetch(
      new Request(new URL(href, origin), {
        method: 'POST',
        headers: { Origin: origin, Cookie: other, 'Content-Type': 'application/json' },
        body: '{',
      }),
    )
    // Ownership is checked before parsing an untrusted board's body.
    assert.equal(response.status, 404)
    assert.equal((await call(b.data.href({ boardId }), undefined, other)).status, 404)
    assert.equal((await call(u.file.href({ fileId: crypto.randomUUID() }))).status, 404)
  })

  it('supports optimistic board writes, watching and lazy navigation without the consumer API', async () => {
    let { call, boardId, columns } = await setup()
    assert.equal((await call(b.rename.href({ boardId }), { name: 'Renamed' })).status, 204)
    let id = crypto.randomUUID()
    await data(
      await call(b.upsertColumn.href({ boardId }), { id, name: 'Review', color: 'violet' }),
    )
    assert.equal(
      (await call(b.moveColumn.href({ boardId, columnId: id }), { direction: 'left' })).status,
      204,
    )
    assert.equal((await call(b.watch.href({ boardId }), { watching: true })).status, 204)
    let cardId = crypto.randomUUID()
    await data(
      await call(b.upsertItem.href({ boardId }), {
        id: cardId,
        title: 'Optimistic',
        columnId: columns[0].id,
        position: 1,
      }),
    )
    await data(
      await call(b.upsertItem.href({ boardId }), {
        id: cardId,
        title: 'Moved',
        columnId: id,
        position: 1,
      }),
    )
    let board = await data(await call(b.data.href({ boardId })))
    assert.equal(board.name, 'Renamed')
    assert.equal(board.items.length, 1)
    assert.equal(board.columns.find((column: { id: string }) => column.id === id).color, 'violet')
    assert.equal((await data(await call(b.options.href())))[0].id, boardId)
    assert.equal(
      (await data(await call(routes.dashboard.navigation.href()))).boards[0].name,
      'Renamed',
    )
    assert.equal((await call(b.deleteColumn.href({ boardId, columnId: id }), {})).status, 204)
    board = await data(await call(b.data.href({ boardId })))
    assert.equal(board.items[0].columnId, columns[0].id)
    assert.equal((await call(b.deleteItem.href({ boardId, itemId: cardId }), {})).status, 204)
    assert.equal((await call(b.destroy.href({ boardId }), {})).status, 204)
  })

  it('projects stored attachments to app URLs, serves private bytes and keeps consumer URLs intact', async () => {
    let { call, db, uploads, router, userId, boardId, columns } = await setup()
    let form = new FormData()
    form.set('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    let upload = await data(await call(u.create.href(), form))
    assert.equal(upload.url, u.file.href({ fileId: upload.id }))
    let descriptionHtml = `<p>Attached</p><action-text-attachment sgid="${upload.id}"></action-text-attachment>`
    let { id: cardId } = await data(
      await call(c.create.href({ boardId }), {
        title: 'With upload',
        columnId: columns[0].id,
        descriptionHtml,
      }),
    )
    let params = { boardId, cardId },
      detail = await data(await call(c.data.href(params)))
    assert.ok(detail.description_html.includes(upload.url))
    assert.equal(detail.description_html.includes('/api/v1/'), false)
    assert.equal((await call(u.discard.href({ fileId: upload.id }), {})).status, 204)
    let download = await call(upload.url)
    assert.equal(await download.text(), 'hello')
    assert.match(download.headers.get('Content-Disposition')!, /attachment/)
    assert.equal(download.headers.get('Cache-Control'), 'private, no-store')
    let other = await signUp(router, 'no-files@example.com')
    assert.equal((await call(upload.url, undefined, other)).status, 404)
    assert.equal((await call(c.uploadFile.href(params), form, other)).status, 404)
    let consumer = await createApi().fetch(
      new Request(new URL(`/api/v1/boards/${boardId}/cards/${cardId}`, origin)),
      { db, uploads, sessionUserId: userId },
    )
    assert.ok((await consumer.json()).data.description_html.includes(`/api/v1/files/${upload.id}`))
    let html = await (await call(c.show.href(params))).text()
    assert.ok(html.includes(upload.url))
    assert.equal(html.includes(`/api/v1/files/${upload.id}`), false)
    assert.equal((await call(b.deleteFile.href({ boardId, fileId: upload.id }), {})).status, 204)
    assert.equal((await call(upload.url)).status, 404)
  })

  it('manages consumer tokens using session-authenticated app actions', async () => {
    let { call, router, db, uploads, userId } = await setup()
    let token = await data(await call(t.create.href(), { name: 'CLI' }))
    assert.match(token.token, /^trx_/)
    let response = await call(t.index.href())
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    let tokens = await data(response)
    assert.equal(tokens[0].name, 'CLI')
    assert.equal(tokens[0].token, undefined)
    let bearer = { Authorization: `Bearer ${token.token}`, Accept: 'application/json' }
    assert.equal(
      (await router.fetch(new Request(new URL(t.index.href(), origin), { headers: bearer })))
        .status,
      401,
    )
    let api = createApi(),
      env = { db, uploads, sessionUserId: null }
    assert.equal(
      (await api.fetch(new Request(new URL('/api/v1/me', origin), { headers: bearer }), env))
        .status,
      200,
    )
    assert.equal((await call(t.revoke.href({ tokenId: token.id }), {})).status, 204)
    assert.equal(
      (await api.fetch(new Request(new URL('/api/v1/me', origin), { headers: bearer }), env))
        .status,
      401,
    )
  })
})
