import { createCookie } from '@remix-run/cookie'
import { createCookieSessionStorage } from '@remix-run/session/cookie-storage'

export function sessionCookie(secret: string) {
  return createCookie('__session', {
    secrets: [secret], httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  })
}

// The web middleware signs an expiration envelope around the cookie-backed session.
// Verify both before trusting an identity. Never accept identity headers from a client.
export async function readSessionUser(request: Request, secret: string): Promise<string | null> {
  let signed = await sessionCookie(secret).parse(request.headers.get('Cookie'))
  if (!signed) return null
  try {
    let envelope = JSON.parse(signed)
    if (typeof envelope.value !== 'string' || typeof envelope.expires !== 'number'
      || !Number.isFinite(envelope.expires) || envelope.expires <= Date.now()) return null
    let session = await createCookieSessionStorage().read(envelope.value)
    let auth = session.get('auth') as { userId?: unknown } | null
    return typeof auth?.userId === 'string' ? auth.userId : null
  } catch { return null }
}
