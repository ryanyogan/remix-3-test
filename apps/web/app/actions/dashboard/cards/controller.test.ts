import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { boardColumns, boardItems, boards } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'
import { createTestRouter, origin, signUp } from '../../../../test/router.ts'

const c = routes.dashboard.cards

// What the browser sends for the card page's forms without JavaScript: fields, no Accept: JSON.
function post(href: string, cookie: string, fields: [string, string][] = []) {
  let body = new URLSearchParams(fields)
  return new Request(new URL(href, origin), {
    method: 'POST',
    body,
    headers: { Origin: origin, Cookie: cookie },
  })
}

async function setup() {
  let { db, router } = await createTestRouter()
  let cookie = await signUp(router)
  await router.fetch(post(routes.dashboard.boards.create.href(), cookie, [['name', 'Plain']]))
  let board = (await db.findMany(boards))[0]
  let columns = await db.findMany(boardColumns, {
    where: { board_id: board.id },
    orderBy: ['position', 'asc'],
  })
  let response = await router.fetch(
    post(c.create.href({ boardId: board.id }), cookie, [
      ['title', 'Plain card'],
      ['columnId', columns[0].id],
    ]),
  )
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('Location'), routes.dashboard.boards.show.href({ boardId: board.id }))
  let card = await db.findOne(boardItems, { where: { title: 'Plain card' } })
  assert.ok(card)
  let params = { boardId: board.id, cardId: card.id }
  let detail = async () => {
    let response = await router.fetch(
      new Request(new URL(c.data.href(params), origin), {
        headers: { Cookie: cookie, Accept: 'application/json' },
      }),
    )
    return (await response.json()).data
  }
  return { db, router, cookie, board, columns, params, detail }
}

describe('card page without JavaScript', () => {
  it('renders forms that post to the card routes', async () => {
    let { router, cookie, params, columns } = await setup()
    let html = await (
      await router.fetch(new Request(new URL(c.show.href(params), origin), { headers: { Cookie: cookie } }))
    ).text()
    for (let href of [c.update.href(params), c.addStep.href(params), c.addComment.href(params)])
      assert.ok(html.includes(`action="${href}"`), href)
    assert.ok(html.includes(`name="columnId" value="${columns[2].id}"`))
    assert.ok(html.includes('name="pinned" value="true"'))
  })

  it('saves stages, pins, and steps, then comes back to the card', async () => {
    let { router, cookie, params, columns, detail } = await setup()
    let back = c.show.href(params)
    let submit = async (href: string, fields: [string, string][]) => {
      let response = await router.fetch(post(href, cookie, fields))
      assert.equal(response.status, 303)
      assert.equal(response.headers.get('Location'), back)
    }

    await submit(c.update.href(params), [['columnId', columns[2].id]])
    await submit(c.update.href(params), [['pinned', 'true']])
    await submit(c.addStep.href(params), [['title', 'Write it down']])
    let card = await detail()
    assert.equal(card.column_id, columns[2].id)
    assert.equal(card.pinned, 1)
    let [step] = card.steps
    assert.equal(step.title, 'Write it down')

    // A checked box follows its hidden "false"; an unchecked one sends only the "false".
    let stepHref = c.updateStep.href({ ...params, stepId: step.id })
    await submit(stepHref, [['completed', 'false'], ['completed', 'true']])
    assert.equal((await detail()).steps[0].completed, 1)
    await submit(stepHref, [['completed', 'false']])
    assert.equal((await detail()).steps[0].completed, 0)

    await submit(c.removeStep.href({ ...params, stepId: step.id }), [])
    assert.deepEqual((await detail()).steps, [])
  })

  it('shows the card again with the reason a post was rejected', async () => {
    let { router, cookie, params, detail } = await setup()
    let response = await router.fetch(post(c.update.href(params), cookie, [['title', ' ']]))
    assert.equal(response.status, 422)
    let html = await response.text()
    assert.match(html, /role="alert"[^>]*>Title must be 1–500 characters/)
    assert.match(html, /Plain card/)
    assert.equal((await detail()).title, 'Plain card')
  })

  it('creates another card, or shows the draft again when it is rejected', async () => {
    let { db, router, cookie, board, columns } = await setup()
    let another = await router.fetch(
      post(c.create.href({ boardId: board.id }), cookie, [
        ['title', 'Second'],
        ['columnId', columns[0].id],
        ['another', 'true'],
      ]),
    )
    assert.equal(another.headers.get('Location'), `${c.new.href()}?board=${board.id}`)

    let rejected = await router.fetch(
      post(c.create.href({ boardId: board.id }), cookie, [
        ['title', 'x'.repeat(501)],
        ['columnId', columns[0].id],
      ]),
    )
    assert.equal(rejected.status, 422)
    let html = await rejected.text()
    assert.match(html, /Create card/)
    assert.match(html, /role="alert"[^>]*>Title must be 1–500 characters/)
    assert.equal((await db.findMany(boardItems)).length, 2)
  })
})
