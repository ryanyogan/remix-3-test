import type { ActivityEvent } from '@trellix/contracts'

type Day = { kind: 'day'; date: string; at: number; events: ActivityEvent[] }
type Gap = { kind: 'gap'; start: number; end: number; count: number }
const dayMs = 86400000

export function activityDays(events: ActivityEvent[], now: number, timeZone: string, leadingGap = true): (Day | Gap)[] {
  let dateKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  // Calendar-day ordinals avoid 23/25-hour DST days changing gap counts.
  function ordinal(at: number) {
    let parts = dateKey.formatToParts(at), get = (type: string) => Number(parts.find(p => p.type === type)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day')) / dayMs
  }
  let days = new Map<number, Day>()
  for (let event of events) {
    let key = ordinal(event.at), day = days.get(key)
    if (!day) { day = { kind: 'day', date: String(key), at: event.at, events: [] }; days.set(key, day) }
    day.events.push(event)
  }
  let output: (Day | Gap)[] = [], previous = leadingGap ? ordinal(now) : undefined
  for (let [key, day] of [...days].sort(([a], [b]) => b - a)) {
    if (previous !== undefined && previous - key > 1) {
      // Find local noon for the gap labels; format with the same timezone as the events.
      let noon = (ordinalDay: number) => {
        let at = ordinalDay * dayMs + 12 * 3600000
        while (ordinal(at) < ordinalDay) at += 3600000
        while (ordinal(at) > ordinalDay) at -= 3600000
        return at
      }
      output.push({ kind: 'gap', start: noon(key + 1), end: noon(previous - 1), count: previous - key - 1 })
    }
    output.push(day); previous = key
  }
  return output
}
