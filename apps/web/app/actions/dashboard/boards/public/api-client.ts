export async function apiRequest<T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response = await fetch(`/api/v1${path}`, {
    method, signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let data = await response.json().catch(() => ({}))
    throw new Error(data.error ?? `Request failed (${response.status})`)
  }
  return response.status === 204 ? undefined as T : (await response.json()).data
}
