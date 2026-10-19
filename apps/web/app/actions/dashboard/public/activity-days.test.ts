import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import type { ActivityEvent } from '@trellix/contracts'
import { activityDays } from './activity-days.ts'

function event(id: string, date: string): ActivityEvent {
  return { id, at: Date.parse(date), cardId: id, title: id, boardId: 'b', boardName: 'Board', color: '#aabbcc', kind: 'added', detail: '', actorId: 'u', actorName: 'Ada' }
}

describe('activity calendar', () => {
  it('groups by the reader’s calendar date, with exact inactivity ranges', () => {
    let days = activityDays([event('a', '2026-10-18T01:00:00Z'), event('b', '2026-10-15T18:00:00Z')], Date.parse('2026-10-20T18:00:00Z'), 'America/Chicago')
    assert.equal(days.length, 4)
    assert.equal(days[0].kind, 'gap')
    if (days[0].kind === 'gap') {
      assert.equal(days[0].count, 2)
      let format = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric' })
      assert.equal(format.format(days[0].start), '10/18')
      assert.equal(format.format(days[0].end), '10/19')
    }
    assert.equal(days[2].kind, 'gap')
    if (days[2].kind === 'gap') assert.equal(days[2].count, 1)
  })
  it('counts calendar days across daylight saving and does not invent a gap on older pages', () => {
    let events = [event('a', '2026-11-03T18:00:00Z'), event('b', '2026-10-31T18:00:00Z')]
    let days = activityDays(events, Date.parse('2026-11-09T18:00:00Z'), 'America/Chicago', false)
    assert.equal(days.length, 3)
    assert.equal(days[0].kind, 'day')
    if (days[1].kind === 'gap') assert.equal(days[1].count, 2)
    else assert.fail('Expected the Nov 1–2 gap')
  })
})
