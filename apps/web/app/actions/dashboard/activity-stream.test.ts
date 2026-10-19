import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { sql } from 'remix/data-table'
import { loadActivityDay } from '@trellix/data/activity'
import { createTestRouter, origin, signUp } from '../../../test/router.ts'
import { routes } from '../../routes.ts'
import { users, boards, boardColumns } from '../../data/tables.ts'

async function setup() {
  let result = await createTestRouter(), cookie = await signUp(result.router)
  let user = await result.db.findOne(users, { where: { email: 'ada@example.com' } })
  assert.ok(user)
  let body = new FormData(); body.set('name', 'Streaming board')
  await result.router.fetch(new Request(new URL(routes.dashboard.boards.create.href(), origin), { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body }))
  let board = await result.db.findOne(boards, { where: { user_id: user.id } })
  assert.ok(board)
  let column = await result.db.findOne(boardColumns, { where: { board_id: board.id } })
  assert.ok(column)
  let boardId = board.id, columnId = column.id
  async function card(id: string, at: number) {
    await result.db.exec(sql`insert into board_items(id, board_id, column_id, title, position, created_at)
      values (${id}, ${boardId}, ${columnId}, ${id}, 0, ${at})`)
  }
  return { ...result, cookie, user, board, card }
}
function request(path: string, cookie?: string) {
  return new Request(new URL(path, origin), { headers: cookie ? { Origin: origin, Cookie: cookie } : undefined })
}

describe('streamed activity', () => {
  it('sends the home shell while activity is still waiting on the database', async (t) => {
    let { router, db, cookie } = await setup()
    let gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
    let exec = db.exec.bind(db)
    t.mock.method(db, 'exec', async (query: string | { text?: string }, values?: unknown[]) => {
      if (typeof query === 'object' && typeof query.text === 'string' && query.text.includes('with visible as')) {
        entered.resolve(); await gate.promise
      }
      return Reflect.apply(exec, db, [query, values])
    })
    let timeout = setTimeout(() => gate.reject(new Error('Home shell waited for activity')), 5000)
    try {
      let response = await router.fetch(request(routes.dashboard.index.href(), cookie))
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
      let reader = response.body!.getReader(), decoder = new TextDecoder()
      let initial = ''
      while (!initial.includes('Loading activity')) { let chunk = await reader.read(); if (chunk.done) break; initial += decoder.decode(chunk.value) }
      assert.match(initial, /dashboard-header/)
      assert.match(initial, /Loading activity/)
      assert.doesNotMatch(initial, /Your next idea/)
      await entered.promise
      gate.resolve()
      let rest = ''
      for (;;) { let chunk = await reader.read(); if (chunk.done) break; rest += decoder.decode(chunk.value) }
      assert.match(rest, /Your next idea starts here/)
    } finally { clearTimeout(timeout); gate.resolve(); db.exec = exec }
  })

  it('pages by local date across midnight and daylight saving, without skipping older days', async () => {
    let { db, user, card } = await setup()
    await card('late', Date.parse('2026-03-09T04:30:00Z')) // Mar 8, 23:30 CDT
    await card('early', Date.parse('2026-03-08T06:30:00Z')) // Mar 8, 00:30 CST
    await card('previous', Date.parse('2026-03-08T05:30:00Z')) // Mar 7
    await card('older', Date.parse('2026-03-04T18:00:00Z'))
    let first = await loadActivityDay(db, user.id, {}, 'America/Chicago')
    assert.deepEqual(first.events.map(event => event.cardId), ['late', 'early'])
    assert.ok(first.next)
    let second = await loadActivityDay(db, user.id, first.next, 'America/Chicago')
    assert.deepEqual(second.events.map(event => event.cardId), ['previous'])
    assert.ok(second.next)
    let third = await loadActivityDay(db, user.id, second.next, 'America/Chicago')
    assert.deepEqual(third.events.map(event => event.cardId), ['older'])
    assert.equal(third.next, null)
  })

  it('continues a busy day with equal timestamps without duplicate or missing events', async () => {
    let { db, user, card } = await setup(), at = Date.parse('2026-10-19T12:00:00Z')
    for (let i = 0; i < 105; i++) await card(`busy-${String(i).padStart(3, '0')}`, at)
    await card('yesterday', at - 86400000)
    let first = await loadActivityDay(db, user.id, {}, 'UTC')
    assert.equal(first.events.length, 100); assert.ok(first.next)
    let second = await loadActivityDay(db, user.id, first.next, 'UTC')
    assert.equal(second.events.length, 5); assert.ok(second.next)
    assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, 105)
    let third = await loadActivityDay(db, user.id, second.next, 'UTC')
    assert.deepEqual(third.events.map(event => event.cardId), ['yesterday'])
    assert.equal(third.next, null)
  })

  it('protects every fragment and keeps board filters through continuation links', async () => {
    let { router, cookie, board, card } = await setup()
    for (let href of [routes.dashboard.activity.href(), routes.dashboard.activityDay.href(), routes.dashboard.activityMore.href()]) {
      assert.equal((await router.fetch(request(href))).status, 303)
    }
    await card('private-today', Date.now()); await card('private-yesterday', Date.now() - 86400000)
    let other = await signUp(router, 'other@example.com')
    let url = routes.dashboard.activityDay.href() + `?board=${board.id}&tz=America%2FChicago`
    let html = await (await router.fetch(request(url, cookie))).text()
    assert.match(html, /private-today/)
    assert.doesNotMatch(html, /private-yesterday/)
    assert.match(html, /activity\/more\?board=/)
    assert.match(html, /tz=America%2FChicago/)
    assert.doesNotMatch(await (await router.fetch(request(url, other))).text(), /private-today|private-yesterday/)
    // Public fragment links also render safely when followed as ordinary GETs.
    assert.equal((await router.fetch(request(url.replace('tz=America%2FChicago', 'tz=invalid'), cookie))).status, 200)
  })
})
