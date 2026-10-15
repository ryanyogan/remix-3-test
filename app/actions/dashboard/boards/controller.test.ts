import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { boardColumns, boardItems, boards } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'
import { createTestRouter, origin, signUp } from '../../../../test/router.ts'

const json = { Accept: 'application/json' }

function get(href: string, cookie: string) {
  return new Request(new URL(href, origin), { headers: { Cookie: cookie } })
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
    headers: { Cookie: cookie, ...headers },
  })
}

async function setup() {
  let { db, router } = await createTestRouter()
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
  return { db, router, cookie, board, columns }
}

describe('boards', () => {
  it('creates a board with To do, In progress, and Done columns', async () => {
    let { board, columns } = await setup()

    assert.equal(board.color, '#ff0000')
    assert.deepEqual(
      columns.map((column) => column.name),
      ['To do', 'In progress', 'Done'],
    )
  })

  it('rejects a blank name and a color that is not a hex value', async () => {
    let { db, router, cookie } = await setup()

    for (let fields of [
      { name: '  ', color: '#ff0000' },
      { name: 'Styled', color: 'red;background:url(x)' },
    ]) {
      let response = await router.fetch(post(routes.dashboard.boards.create.href(), cookie, fields))
      assert.equal(response.status, 400)
    }
    assert.equal((await db.findMany(boards)).length, 1)
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
    assert.match(html, /<title>Launch · Dashboard<\/title>/)
    assert.match(html, /In progress/)
  })

  it('creates, moves, and deletes cards, answering fetches with 204', async () => {
    let { db, router, cookie, board, columns } = await setup()
    let [todo, , done] = columns
    let itemsHref = routes.dashboard.boards.upsertItem.href({ boardId: board.id })

    let create = await router.fetch(
      post(
        itemsHref,
        cookie,
        { id: 'card-1', columnId: todo.id, title: ' Ship ', position: '1' },
        json,
      ),
    )
    assert.equal(create.status, 204)
    let card = await db.find(boardItems, 'card-1')
    assert.equal(card?.title, 'Ship')
    assert.equal(card?.column_id, todo.id)

    let move = await router.fetch(
      post(
        itemsHref,
        cookie,
        { id: 'card-1', columnId: done.id, title: 'Ship', position: '1.5' },
        json,
      ),
    )
    assert.equal(move.status, 204)
    card = await db.find(boardItems, 'card-1')
    assert.equal(card?.column_id, done.id)
    assert.equal(Number(card?.position), 1.5)

    let deleteHref = routes.dashboard.boards.deleteItem.href({
      boardId: board.id,
      itemId: 'card-1',
    })
    assert.equal((await router.fetch(post(deleteHref, cookie, {}, json))).status, 204)
    assert.equal(await db.find(boardItems, 'card-1'), null)
    // Deleting again is not an error, so a delete can race a pending create.
    assert.equal((await router.fetch(post(deleteHref, cookie, {}, json))).status, 204)
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

    await router.fetch(post(href, cookie, { id: 'col-new', name: 'Review' }, json))
    let column = await db.find(boardColumns, 'col-new')
    assert.equal(column?.name, 'Review')
    assert.equal(Number(column?.position), 4)

    await router.fetch(post(href, cookie, { id: 'col-new', name: 'QA' }, json))
    assert.equal((await db.find(boardColumns, 'col-new'))?.name, 'QA')
  })

  it('renames and deletes the board', async () => {
    let { db, router, cookie, board } = await setup()

    let rename = await router.fetch(
      post(
        routes.dashboard.boards.rename.href({ boardId: board.id }),
        cookie,
        { name: 'Ship it' },
        json,
      ),
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
      post(itemsHref, cookie, { id: 'mine', columnId: columns[0].id, title: 'Mine' }, json),
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
      post(itemsHref, otherCookie, { id: 'mine', columnId: columns[0].id, title: 'Stolen' }),
      post(
        routes.dashboard.boards.deleteItem.href({ boardId: board.id, itemId: 'mine' }),
        otherCookie,
      ),
    ]) {
      assert.equal((await router.fetch(request)).status, 404)
    }
    assert.equal((await db.find(boardItems, 'mine'))?.title, 'Mine')

    // Their own board cannot adopt this board's card or column ids either.
    await router.fetch(post(routes.dashboard.boards.create.href(), otherCookie, { name: 'Theirs' }))
    let theirs = await db.findOne(boards, { where: { name: 'Theirs' } })
    assert.ok(theirs)
    let theirColumn = await db.findOne(boardColumns, { where: { board_id: theirs.id } })
    assert.ok(theirColumn)
    let hijack = await router.fetch(
      post(
        routes.dashboard.boards.upsertItem.href({ boardId: theirs.id }),
        otherCookie,
        { id: 'mine', columnId: theirColumn.id, title: 'Stolen' },
        json,
      ),
    )
    assert.equal(hijack.status, 404)
    let foreignColumn = await router.fetch(
      post(
        routes.dashboard.boards.upsertItem.href({ boardId: theirs.id }),
        otherCookie,
        { id: 'new', columnId: columns[0].id, title: 'Sneaky' },
        json,
      ),
    )
    assert.equal(foreignColumn.status, 404)
    assert.equal((await db.find(boardItems, 'mine'))?.title, 'Mine')
  })
})
