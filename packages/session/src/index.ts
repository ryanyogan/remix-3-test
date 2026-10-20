import { createCookie } from '@remix-run/cookie'
import { createCookieSessionStorage } from '@remix-run/session/cookie-storage'

export function sessionCookie(secret: string) {
  return createCookie('__session', {
    secrets: [secret], httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  })
}

// The web middleware signs an expiration envelope around the cookie-backed session.
// Verify both before trusting an identity. Never accept identity headers from a client.
// `version` is the user's session_version when the session was issued; callers must reject a
// session whose version no longer matches, since signing out bumps it.
export interface SessionUser { userId: string; version: number }

// What the web app stores under the session's `auth` key. Sessions issued before versions
// existed have none, which counts as version 0.
export interface SessionAuth { userId: string; version?: number }

export async function readSessionUser(request: Request, secret: string): Promise<SessionUser | null> {
  let signed = await sessionCookie(secret).parse(request.headers.get('Cookie'))
  if (!signed) return null
  try {
    let envelope = JSON.parse(signed)
    if (typeof envelope.value !== 'string' || typeof envelope.expires !== 'number'
      || !Number.isFinite(envelope.expires) || envelope.expires <= Date.now()) return null
    let session = await createCookieSessionStorage().read(envelope.value)
    let auth = session.get('auth') as { userId?: unknown; version?: unknown } | null
    if (typeof auth?.userId !== 'string') return null
    return { userId: auth.userId, version: typeof auth.version === 'number' ? auth.version : 0 }
  } catch { return null }
}
