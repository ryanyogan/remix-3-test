export async function appRequest<T = unknown>(
  href: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // A form's fields go as the browser would post them; anything else goes as JSON.
  let json = body !== undefined && !(body instanceof FormData)
  let response = await fetch(href, {
    method,
    signal,
    headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(body) : (body as FormData | undefined),
  })
  if (!response.ok) {
    let data = await response.json().catch(() => ({}))
    throw new Error(data.error ?? `Request failed (${response.status})`)
  }
  return response.status === 204 ? (undefined as T) : (await response.json()).data
}
