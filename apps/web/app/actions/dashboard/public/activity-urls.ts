import type { ActivityFilters } from '@trellix/contracts'

export function readActivityFilters(url: URL): ActivityFilters {
  let params = url.searchParams, before = Number(params.get('before'))
  return {
    board: params.get('board') ?? '', person: params.get('person') ?? '',
    tag: params.get('tag') ?? '', view: params.get('view') ?? '',
    before: Number.isSafeInteger(before) && before > 0 ? before : undefined,
    beforeId: params.get('beforeId') ?? '',
  }
}

export function activityHref(path: string, filters: ActivityFilters, timeZone?: string) {
  let params = new URLSearchParams()
  for (let [key, value] of Object.entries(filters)) if (value) params.set(key, String(value))
  if (timeZone) params.set('tz', timeZone)
  return path + (params.size ? `?${params}` : '')
}

export function activityTimeZone(value?: string | null) {
  try { return new Intl.DateTimeFormat('en', { timeZone: value || 'UTC' }).resolvedOptions().timeZone }
  catch { return 'UTC' }
}
