import { HTTPException } from 'hono/http-exception'

export function textField(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) {
    throw new HTTPException(422, { message: `${name} must be ${empty ? '0' : '1'}–${max} characters` })
  }
  return value.trim()
}

export function numberField(value: unknown, name: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new HTTPException(422, { message: `${name} must be a finite number of at least ${min}` })
  }
  return value
}

export function booleanField(value: unknown, name: string): number {
  if (typeof value !== 'boolean') throw new HTTPException(422, { message: `${name} must be true or false` })
  return Number(value)
}

export async function tokenHash(token: string): Promise<string> {
  let digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
