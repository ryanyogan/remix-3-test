export async function appRequest<T = unknown>(
  href: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response = await fetch(href, {
    method,
    signal,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let data = await response.json().catch(() => ({}))
    throw new Error(data.error ?? `Request failed (${response.status})`)
  }
  return response.status === 204 ? (undefined as T) : (await response.json()).data
}
