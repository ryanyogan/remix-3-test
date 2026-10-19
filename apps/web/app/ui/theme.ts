import { createCookie } from 'remix/cookie'

export type Theme = 'light' | 'dark'

// A display preference, not a secret: unsigned, and readable by the toggle's script.
export const themeCookie = createCookie('theme', {
  path: '/',
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 365,
})

// The saved theme, or undefined to follow the OS.
export async function readTheme(request: Request): Promise<Theme | undefined> {
  let value = await themeCookie.parse(request.headers.get('Cookie'))
  return isTheme(value) ? value : undefined
}

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}
