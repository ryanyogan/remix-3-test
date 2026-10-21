import * as assert from 'remix/assert'
import { DataTableValidationError, sql } from 'remix/data-table'
import { describe, it } from 'remix/test'

import { boardColumns, boardItemFiles, boardItems, boards } from '../../../data/tables.ts'
import { limits } from '../../../data/limits.ts'
import { routes } from '../../../routes.ts'
import { createTestRouter, origin, signUp } from '../../../../test/router.ts'

const json = { Accept: 'application/json' }

function get(href: string, cookie: string) {
  return new Request(new URL(href, origin), { headers: { Origin: origin, Cookie: cookie } })
}

function post(
  href: string,
  cookie: string,
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  let body = new FormData()
  for (let [name, value] of Object.entries(fields)) body.set(name, value)
  return new Request(new URL(href, origin), {
    method: 'POST',
    body,
    headers: { Origin: origin, Cookie: cookie, ...headers },
  })
}

// What the enhanced board sends: JSON, asking for JSON back.
function send(href: string, cookie: string, body: Record<string, unknown> = {}) {
  return new Request(new URL(href, origin), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Origin: origin, Cookie: cookie, ...json, 'Content-Type': 'application/json' },
  })
}

// The browser generates card, column, and file ids as UUIDs.
const id = (name: string) =>
  `00000000-0000-4000-8000-${[...name].map((c) => c.charCodeAt(0).toString(16)).join('').padStart(12, '0').slice(-12)}`

async function setup(database: 'sqlite' | 'd1' = 'sqlite') {
  let { db, router, uploads } = await createTestRouter(database)
  let cookie = await signUp(router)

  let response = await router.fetch(
    post(routes.dashboard.boards.create.href(), cookie, { name: ' Launch ', color: '#ff0000' }),
  )
  let board = await db.findOne(boards, { where: { name: 'Launch' } })
  assert.ok(board)
  assert.equal(response.status, 303)
  assert.equal(
    response.headers.get('Location'),
    routes.dashboard.boards.show.href({ boardId: board.id }),
  )

  let columns = await db.findMany(boardColumns, {
    where: { board_id: board.id },
    orderBy: ['position', 'asc'],
  })
  return { db, router, uploads, cookie, board, columns }
}

describe('boards', () => {
  it('links the globe and gear to owner-only board pages', async () => {
    let { router, cookie, board } = await setup()
    let edit = routes.dashboard.boards.edit.href({ boardId: board.id })
    let webhooks = routes.dashboard.boards.webhooks.href({ boardId: board.id })
    let html = await (await router.fetch(get(routes.dashboard.boards.show.href({ boardId: board.id }), cookie))).text()
    assert.ok(html.includes(`href="${edit}"`))
    assert.ok(html.includes(`href="${webhooks}"`))
    assert.match(await (await router.fetch(get(edit, cookie))).text(), /Name this board/)
    assert.match(await (await router.fetch(get(webhooks, cookie))).text(), /Webhook delivery/)
    let other = await signUp(router, 'other-board@example.com')
    for (let href of [edit, webhooks]) {
      assert.equal((await router.fetch(get(href, other))).status, 404)
      assert.equal((await router.fetch(get(href, ''))).status, 303)
    }
  })

  it('creates a board with To do, In progress, and Done columns', async () => {
    let { board, columns } = await setup()

    assert.equal(board.color, '#cbd5e1')
    assert.deepEqual(
      columns.map((column) => column.name),
      ['To do', 'In progress', 'Done'],
    )
  })

  it('renders a private, name-only creation page and redirects old creation links', async () => {
    let { router, cookie } = await setup()
    let response = await router.fetch(get(routes.dashboard.boards.new.href(), cookie))
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Create a new board/)
    assert.match(html, /placeholder="Name it…"/)
    assert.equal(html.includes('name="color"'), false)
    response = await router.fetch(get(routes.dashboard.boards.new.href(), ''))
    assert.equal(response.status, 303)
    response = await router.fetch(get(routes.dashboard.boards.index.href() + '?new=1', cookie))
    assert.equal(response.headers.get('Location'), routes.dashboard.boards.new.href())
  })

  it('re-renders invalid names on the creation page without creating a board', async () => {
    let { db, router, cookie } = await setup()
    for (let name of ['  ', 'x'.repeat(limits.name + 1)]) {
      let response = await router.fetch(post(routes.dashboard.boards.create.href(), cookie, { name }))
      assert.equal(response.status, 400)
      let html = await response.text()
      assert.match(html, /Create a new board/)
      assert.match(html, /role="alert"/)
      assert.ok(html.includes(name))
    }
    assert.equal((await db.findMany(boards)).length, 1)
  })

  it('renders full card routes and protects card ownership', async () => {
    let { db, router, cookie, board, columns } = await setup()
    let response = await router.fetch(get(routes.dashboard.cards.new.href() + `?board=${board.id}`, cookie))
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /class="perma-frame"/)
    assert.match(html, /Create card/)
    await router.fetch(post(routes.dashboard.boards.upsertItem.href({ boardId: board.id }), cookie, { id: id('route-card'), columnId: columns[0].id, title: 'Full page card' }))
    let href = routes.dashboard.cards.show.href({ boardId: board.id, cardId: id('route-card') })
    response = await router.fetch(get(href, cookie))
    assert.equal(response.status, 200)
    html = await response.text()
    assert.match(html, /Full page card/)
    assert.equal(html.includes('class="card-sheet"'), false)
    response = await router.fetch(get(routes.dashboard.boards.show.href({ boardId: board.id }) + `?card=${id('route-card')}`, cookie))
    assert.equal(response.headers.get('Location'), href)
    let other = await signUp(router, 'card-other@example.test')
    assert.equal((await router.fetch(get(href, other))).status, 404)
    assert.equal((await router.fetch(get(routes.dashboard.cards.new.href() + `?board=${board.id}`, other))).status, 404)
  })

  it('lists boards and renders the board with its columns', async () => {
    let { router, cookie, board } = await setup()

    let list = await (await router.fetch(get(routes.dashboard.boards.index.href(), cookie))).text()
    assert.match(list, />Launch</)
    assert.match(list, /0 cards/)

    let show = await router.fetch(
      get(routes.dashboard.boards.show.href({ boardId: board.id }), cookie),
    )
    assert.equal(show.status, 200)
    let html = await show.text()
    assert.match(html, /<title>Launch · Trellix<\/title>/)
    assert.match(html, /In progress/)
  })

  it('creates, moves, and deletes cards, answering fetches with JSON', async () => {
    let { db, router, cookie, board, columns } = await setup()
    let [todo, , done] = columns
    let itemsHref = routes.dashboard.boards.upsertItem.href({ boardId: board.id })

    let create = await router.fetch(
      send(itemsHref, cookie, { id: id('card-1'), columnId: todo.id, title: ' Ship ', position: 1 }),
    )
    assert.equal(create.status, 200)
    assert.deepEqual(await create.json(), { data: { id: id('card-1') } })
    let card = await db.find(boardItems, id('card-1'))
    assert.equal(card?.title, 'Ship')
    assert.equal(card?.column_id, todo.id)

    let move = await router.fetch(
      send(itemsHref, cookie, { id: id('card-1'), columnId: done.id, title: 'Ship', position: 1.5 }),
    )
    assert.equal(move.status, 200)
    card = await db.find(boardItems, id('card-1'))
    assert.equal(card?.column_id, done.id)
    assert.equal(Number(card?.position), 1.5)

    let deleteHref = routes.dashboard.boards.deleteItem.href({
      boardId: board.id,
      itemId: id('card-1'),
    })
    assert.equal((await router.fetch(send(deleteHref, cookie, {}))).status, 204)
    assert.equal(await db.find(boardItems, id('card-1')), null)
    // Deleting again is not an error, so a delete can race a pending create.
    assert.equal((await router.fetch(send(deleteHref, cookie, {}))).status, 204)
  })

  it('redirects plain form posts back to the board and appends new cards', async () => {
    let { db, router, cookie, board, columns } = await setup()
    let itemsHref = routes.dashboard.boards.upsertItem.href({ boardId: board.id })

    for (let title of ['First', 'Second']) {
      let response = await router.fetch(post(itemsHref, cookie, { columnId: columns[0].id, title }))
      assert.equal(response.status, 303)
      assert.equal(
        response.headers.get('Location'),
        routes.dashboard.boards.show.href({ boardId: board.id }),
      )
    }

    let items = await db.findMany(boardItems, { orderBy: ['position', 'asc'] })
    assert.deepEqual(
      items.map((item) => [item.title, Number(item.position)]),
      [
        ['First', 1],
        ['Second', 2],
      ],
    )
  })

  it('adds and renames columns through one upsert', async () => {
    let { db, router, cookie, board } = await setup()
    let href = routes.dashboard.boards.upsertColumn.href({ boardId: board.id })

    await router.fetch(send(href, cookie, { id: id('col-new'), name: 'Review' }))
    let column = await db.find(boardColumns, id('col-new'))
    assert.equal(column?.name, 'Review')
    assert.equal(Number(column?.position), 2.5)

    await router.fetch(send(href, cookie, { id: id('col-new'), name: 'QA' }))
    assert.equal((await db.find(boardColumns, id('col-new')))?.name, 'QA')
  })

  it('renames and deletes the board', async () => {
    let { db, router, cookie, board } = await setup()

    let rename = await router.fetch(
      send(routes.dashboard.boards.rename.href({ boardId: board.id }), cookie, { name: 'Ship it' }),
    )
    assert.equal(rename.status, 204)
    assert.equal((await db.find(boards, board.id))?.name, 'Ship it')

    let destroy = await router.fetch(
      post(routes.dashboard.boards.destroy.href({ boardId: board.id }), cookie),
    )
    assert.equal(destroy.status, 303)
    assert.equal(destroy.headers.get('Location'), routes.dashboard.boards.index.href())
    assert.equal(await db.find(boards, board.id), null)
    assert.equal((await db.findMany(boardColumns)).length, 0)
  })

  it("hides another user's board and its cards", async () => {
    let { db, router, cookie, board, columns } = await setup()
    let itemsHref = routes.dashboard.boards.upsertItem.href({ boardId: board.id })
    await router.fetch(
      send(itemsHref, cookie, { id: id('mine'), columnId: columns[0].id, title: 'Mine' }),
    )

    let otherCookie = await signUp(router, 'grace@example.com', 'Grace Hopper')
    assert.equal(
      (
        await router.fetch(
          get(routes.dashboard.boards.show.href({ boardId: board.id }), otherCookie),
        )
      ).status,
      404,
    )
    for (let request of [
      post(routes.dashboard.boards.rename.href({ boardId: board.id }), otherCookie, { name: 'x' }),
      post(routes.dashboard.boards.destroy.href({ boardId: board.id }), otherCookie),
      post(itemsHref, otherCookie, { id: id('mine'), columnId: columns[0].id, title: 'Stolen' }),
      post(
        routes.dashboard.boards.deleteItem.href({ boardId: board.id, itemId: id('mine') }),
        otherCookie,
      ),
    ]) {
      assert.equal((await router.fetch(request)).status, 404)
    }
    assert.equal((await db.find(boardItems, id('mine')))?.title, 'Mine')

    // Their own board cannot adopt this board's card or column ids either.
    await router.fetch(post(routes.dashboard.boards.create.href(), otherCookie, { name: 'Theirs' }))
    let theirs = await db.findOne(boards, { where: { name: 'Theirs' } })
    assert.ok(theirs)
    let theirColumn = await db.findOne(boardColumns, { where: { board_id: theirs.id } })
    assert.ok(theirColumn)
    let hijack = await router.fetch(
      send(routes.dashboard.boards.upsertItem.href({ boardId: theirs.id }), otherCookie, { id: id('mine'), columnId: theirColumn.id, title: 'Stolen' }),
    )
    assert.equal(hijack.status, 404)
    let foreignColumn = await router.fetch(
      send(routes.dashboard.boards.upsertItem.href({ boardId: theirs.id }), otherCookie, { id: id('new'), columnId: columns[0].id, title: 'Sneaky' }),
    )
    assert.equal(foreignColumn.status, 404)
    assert.equal((await db.find(boardItems, id('mine')))?.title, 'Mine')
  })
})

function upload(href: string, cookie: string, file: File, id?: string) {
  let body = new FormData()
  if (id) body.set('id', id)
  body.set('file', file)
  return new Request(new URL(href, origin), {
    method: 'POST',
    body,
    headers: { Origin: origin, Cookie: cookie, ...json },
  })
}

async function setupCard(database: 'sqlite' | 'd1' = 'sqlite') {
  let context = await setup(database)
  let { router, cookie, board, columns } = context
  await router.fetch(
    send(routes.dashboard.boards.upsertItem.href({ boardId: board.id }), cookie, { id: id('card-1'), columnId: columns[0].id, title: 'Has files', position: 1 }),
  )
  let uploadHref = routes.dashboard.boards.uploadFile.href({ boardId: board.id, itemId: id('card-1') })
  return { ...context, uploadHref }
}

describe('card attachments', () => {
  it('stores an upload under its id and lists it on the board', async () => {
    let { db, router, uploads, cookie, board, uploadHref } = await setupCard()

    let response = await router.fetch(
      upload(
        uploadHref,
        cookie,
        new File(['hello'], 'notes.txt', { type: 'text/plain' }),
        id('file-1'),
      ),
    )
    assert.equal(response.status, 204)

    let row = await db.find(boardItemFiles, id('file-1'))
    assert.equal(row?.name, 'notes.txt')
    assert.equal(row?.size, 5)
    assert.equal(await (await uploads.get(id('file-1')))?.text(), 'hello')

    let html = await (
      await router.fetch(get(routes.dashboard.boards.show.href({ boardId: board.id }), cookie))
    ).text()
    assert.match(html, /notes\.txt/)
  })

  it('serves images inline and other files as downloads', async () => {
    let { router, cookie, board, uploadHref } = await setupCard()
    await router.fetch(
      upload(uploadHref, cookie, new File(['png'], 'pic.png', { type: 'image/png' }), id('img')),
    )
    await router.fetch(
      upload(uploadHref, cookie, new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }), id('svg')),
    )

    let image = await router.fetch(
      get(routes.dashboard.boards.file.href({ boardId: board.id, fileId: id('img') }), cookie),
    )
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('Content-Type'), 'image/png')
    assert.match(image.headers.get('Content-Disposition') ?? '', /^inline;/)
    assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff')

    let svg = await router.fetch(
      get(routes.dashboard.boards.file.href({ boardId: board.id, fileId: id('svg') }), cookie),
    )
    assert.match(
      svg.headers.get('Content-Disposition') ?? '',
      /^attachment; filename\*=UTF-8''x\.svg/,
    )
  })

  it("keeps files private to the board's owner", async () => {
    let { router, cookie, board, uploadHref } = await setupCard()
    await router.fetch(upload(uploadHref, cookie, new File([id('secret')], 's.txt'), id('secret')))

    let otherCookie = await signUp(router, 'grace@example.com', 'Grace Hopper')
    let fileHref = routes.dashboard.boards.file.href({ boardId: board.id, fileId: id('secret') })
    assert.equal((await router.fetch(get(fileHref, otherCookie))).status, 404)
    assert.equal(
      (await router.fetch(upload(uploadHref, otherCookie, new File(['x'], 'x.txt')))).status,
      404,
    )
    let anonymous = await router.fetch(new Request(new URL(fileHref, origin)))
    assert.equal(anonymous.status, 303)
  })

  it('removes stored bytes with the file, the card, and the board', async () => {
    let { router, uploads, cookie, board, uploadHref } = await setupCard()
    for (let name of ['a', 'b', 'c']) {
      await router.fetch(upload(uploadHref, cookie, new File([name], `${name}.txt`), id(name)))
    }

    await router.fetch(
      post(
        routes.dashboard.boards.deleteFile.href({ boardId: board.id, fileId: id('a') }),
        cookie,
        {},
        json,
      ),
    )
    assert.equal(await uploads.get(id('a')), null)
    assert.ok(await uploads.get(id('b')))

    await router.fetch(
      post(
        routes.dashboard.boards.deleteItem.href({ boardId: board.id, itemId: id('card-1') }),
        cookie,
        {},
        json,
      ),
    )
    assert.equal(await uploads.get(id('b')), null)
    assert.equal(await uploads.get(id('c')), null)
  })

  it('deletes a column while preserving its cards and attachment bytes', async () => {
    let { db, router, uploads, cookie, board, columns, uploadHref } = await setupCard()
    await router.fetch(upload(uploadHref, cookie, new File(['a'], 'a.txt'), id('a')))
    let href = (columnId: string) =>
      routes.dashboard.boards.deleteColumn.href({ boardId: board.id, columnId })

    let response = await router.fetch(send(href(columns[0].id), cookie, {}))
    assert.equal(response.status, 204)
    assert.equal(await db.find(boardColumns, columns[0].id), null)
    assert.equal((await db.find(boardItems, id('card-1')))?.column_id, columns[1].id)
    assert.ok(await db.find(boardItemFiles, id('a')))
    assert.ok(await uploads.get(id('a')))
    assert.ok(await db.find(boardColumns, columns[1].id))

    // Already gone is fine; a plain form post goes back to the board.
    let again = await router.fetch(post(href(columns[0].id), cookie))
    assert.equal(again.status, 303)
  })

  it("does not delete another user's column", async () => {
    let { db, router, board, columns } = await setup()
    let other = await signUp(router, 'grace@example.com', 'Grace Hopper')

    let response = await router.fetch(
      post(
        routes.dashboard.boards.deleteColumn.href({ boardId: board.id, columnId: columns[0].id }),
        other,
        {},
        json,
      ),
    )
    assert.equal(response.status, 404)
    assert.ok(await db.find(boardColumns, columns[0].id))
  })

  it('rejects empty files, oversized files, and a full card', async () => {
    let { db, router, cookie, uploadHref } = await setupCard()

    let empty = await router.fetch(upload(uploadHref, cookie, new File([], 'empty.txt')))
    assert.equal(empty.status, 422)
    assert.deepEqual(await empty.json(), { error: `Choose one nonempty file of at most ${limits.fileLabel}` })

    let big = new File([new Uint8Array(limits.fileBytes + 1)], 'big.bin')
    let tooBig = await router.fetch(upload(uploadHref, cookie, big))
    assert.equal(tooBig.status, 413)
    assert.match((await tooBig.json()).error, /10 MB or smaller/)

    for (let i = 0; i < limits.filesPerCard; i++) {
      await router.fetch(upload(uploadHref, cookie, new File(['x'], `${i}.txt`)))
    }
    let full = await router.fetch(upload(uploadHref, cookie, new File(['x'], 'one-more.txt')))
    assert.equal(full.status, 422)
    assert.match((await full.json()).error, /up to 10 files/)
    assert.equal((await db.findMany(boardItemFiles)).length, limits.filesPerCard)
  })

  for (let database of ['sqlite', 'd1'] as const) {
    it(`leaves no stored bytes when the file row fails to commit (${database})`, async () => {
      let { db, router, uploads, cookie, uploadHref } = await setupCard(database)
      // D1 commits queued writes after the transaction callback, so this fails after the
      // bytes were stored.
      await db.exec(sql`create trigger reject_files before insert on board_item_files
        begin select raise(abort, 'rejected'); end`)

      let response = await router.fetch(upload(uploadHref, cookie, new File(['x'], 'x.txt'), id('file-1')))
      assert.equal(response.status, 500)
      assert.equal(await uploads.has(id('file-1')), false)
    })
  }
})

describe('validation', () => {
  it('answers enhanced requests with a message the board can show', async () => {
    let { router, cookie, board, columns } = await setup()
    let itemsHref = routes.dashboard.boards.upsertItem.href({ boardId: board.id })

    let blank = await router.fetch(
      send(itemsHref, cookie, { columnId: columns[0].id, title: '  ' }),
    )
    assert.equal(blank.status, 422)
    assert.deepEqual(await blank.json(), { error: 'Title must be 1–500 characters' })

    let long = await router.fetch(
      send(itemsHref, cookie, { columnId: columns[0].id, title: 'x'.repeat(501) }),
    )
    assert.deepEqual(await long.json(), { error: 'Title must be 1–500 characters' })

    let plain = await router.fetch(
      post(routes.dashboard.boards.rename.href({ boardId: board.id }), cookie, { name: '' }),
    )
    assert.equal(plain.status, 422)
    assert.equal(await plain.text(), 'Name must be 1–100 characters')
  })

  it('guards every write at the table, not only form input', async () => {
    let { db, board, columns } = await setup()

    let attempts = [
      () =>
        db.create(boardItems, {
          id: 'x',
          board_id: board.id,
          column_id: columns[0].id,
          title: ' ',
          position: 1,
          created_at: 0,
        }),
      () =>
        db.create(boardItems, {
          id: 'y',
          board_id: board.id,
          column_id: columns[0].id,
          title: 'ok',
          position: Number.NaN,
          created_at: 0,
        }),
      () => db.update(boards, board.id, { color: 'red;background:url(x)' }),
      () => db.update(boardColumns, columns[0].id, { name: 'x'.repeat(101) }),
    ]
    for (let attempt of attempts) {
      await assert.rejects(attempt, (error: unknown) => error instanceof DataTableValidationError)
    }
    assert.equal(await db.find(boardItems, 'x'), null)
    // A partial update that leaves validated fields alone still succeeds.
    await db.update(boards, board.id, { created_at: 1 })
  })
})
